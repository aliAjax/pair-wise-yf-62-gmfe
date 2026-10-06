'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Grid,
  Group,
  List,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Timeline,
  Title
} from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useState } from 'react';
import { useCommandStore } from '@/lib/store';
import { useLedger } from '@/lib/useLedger';
import { SearchMap } from '@/components/SearchMap';
import { CoverageLedgerCard, SharedBeltsCard } from '@/components/CoverageLedgerCard';
import { CapacityCard, MissionQueueCard } from '@/components/MissionQueueCard';
import { LedgerRowsCard, ReportsCard } from '@/components/LedgerRowsCard';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  assetIds: z.array(z.string()).min(1, '至少调派一个单位'),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160),
  hours: z.number().min(1).max(12)
});

type MissionFormInput = z.input<typeof missionSchema>;
type MissionFormValues = z.output<typeof missionSchema>;

const KIND_COLOR: Record<string, string> = {
  plan: 'blue',
  track: 'teal',
  ledger: 'orange',
  system: 'gray'
};

export default function CommandPage() {
  const state = useCommandStore();
  const { areaStats, gaps, rows, scheduled } = useLedger();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['heli-02']);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<MissionFormInput, unknown, MissionFormValues>({
    resolver: zodResolver(missionSchema),
    defaultValues: {
      title: '',
      areaId: state.areas[0]?.id,
      assetIds: selectedAssets,
      priority: 'normal',
      note: '',
      hours: 2
    }
  });

  const brief = useQuery({
    queryKey: ['sea-state'],
    queryFn: async () => ({ wind: '东北风 6级', visibility: '4.2海里', tide: '涨潮' }),
    refetchInterval: state.lowBandwidth ? false : 60_000
  });

  const submitMission = (values: MissionFormValues) => {
    const start = new Date();
    const end = new Date(start.getTime() + values.hours * 3600_000);
    state.dispatchMission({
      title: values.title,
      areaId: values.areaId,
      assetIds: selectedAssets,
      priority: values.priority,
      note: values.note,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString()
    });
    reset({
      title: '',
      areaId: state.areas[0]?.id,
      assetIds: selectedAssets,
      priority: 'normal',
      note: '',
      hours: 2
    });
  };

  const totalPrimary = areaStats.reduce((n, s) => n + s.primaryCells, 0);
  const queuedCount = scheduled.filter((m) => m.status === 'queued').length;
  const stalePositions = state.assets.filter(
    (item) => Date.now() - new Date(item.lastSeen).getTime() > 10 * 60_000
  ).length;

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div>
            <Badge color={state.offline ? 'red' : 'teal'}>
              {state.offline ? '离线缓存模式' : '联合指挥在线'}
            </Badge>
            <Title order={1} className="section-title">海上搜救联合指挥 · 责任账</Title>
            <Text c="dimmed">任务单、搜索区、执行单位按实际航迹记账，交叠定主责、同时段唯一计入、离线按业务编号对账</Text>
          </div>
          <Group>
            <Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} />
            <Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} />
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 5 }}>
          {[
            ['活动搜索区', state.areas.filter((i) => i.status === 'active').length],
            ['在执行任务', scheduled.filter((i) => i.status === 'in_progress').length],
            ['排队任务', queuedCount],
            ['漏飞时段', gaps.length],
            ['过期位置', stalePositions]
          ].map(([label, value]) => (
            <Card key={String(label)} withBorder>
              <Text size="sm" c="dimmed">{label}</Text>
              <Title order={2}>{value}</Title>
            </Card>
          ))}
        </SimpleGrid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card withBorder>
              <Group justify="space-between">
                <Title order={3}>搜救态势（灰虚线=晚到补历史，琥珀=共享带主责，红虚线=未定主责）</Title>
                <Text size="sm">风况：{brief.data?.wind ?? '读取中'} · 能见度：{brief.data?.visibility ?? '--'}</Text>
              </Group>
              <SearchMap areas={state.areas} assets={state.assets} belts={state.belts} tracks={state.tracks} />
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <SharedBeltsCard />
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 7 }}><CoverageLedgerCard /></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Stack gap="lg">
              <ReportsCard />
              <CapacityCard />
            </Stack>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Card withBorder>
              <Title order={3}>派发新任务单</Title>
              <form onSubmit={handleSubmit(submitMission)}>
                <Stack mt="md">
                  <TextInput label="任务名称" {...register('title')} error={errors.title?.message} />
                  <label>
                    搜索区
                    <select {...register('areaId')} style={{ width: '100%', padding: 8 }}>
                      {state.areas.map((area) => (
                        <option key={area.id} value={area.id}>{area.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    调派单位（可多选）
                    <select
                      multiple
                      value={selectedAssets}
                      onChange={(event) =>
                        setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (o) => o.value))
                      }
                      style={{ width: '100%', minHeight: 96 }}
                    >
                      {state.assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.name}（容量{asset.concurrentCapacity}）</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    优先级
                    <select {...register('priority')} style={{ width: '100%', padding: 8 }}>
                      <option value="normal">常规</option>
                      <option value="urgent">紧急</option>
                    </select>
                  </label>
                  <label>
                    计划时长（小时，自现在起）
                    <input
                      type="number"
                      min={1}
                      max={12}
                      {...register('hours', { setValueAs: (v) => Number(v) })}
                      style={{ width: '100%', padding: 8 }}
                    />
                    {errors.hours && <Text size="xs" c="red">{errors.hours.message}</Text>}
                  </label>
                  <Textarea label="任务说明" {...register('note')} />
                  <Button type="submit">派发任务（容量不足自动排队）</Button>
                </Stack>
              </form>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}><MissionQueueCard /></Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Card withBorder h="100%">
              <Title order={3}>单位状态</Title>
              <Stack mt="md">
                {state.assets.map((asset) => {
                  const stale = Date.now() - new Date(asset.lastSeen).getTime() > 10 * 60_000;
                  return (
                    <Card key={asset.id} withBorder padding="sm">
                      <Group justify="space-between">
                        <b>{asset.name}</b>
                        <Badge color={asset.status === 'offline' ? 'red' : asset.status === 'assigned' ? 'blue' : 'teal'}>
                          {asset.status}
                        </Badge>
                      </Group>
                      <Text size="xs" c={stale ? 'red' : 'dimmed'}>
                        {stale ? '位置已过期 · ' : ''}
                        {formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}
                      </Text>
                      <Group mt="xs">
                        <Button
                          size="compact-xs"
                          onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}
                        >
                          {asset.status === 'offline' ? '恢复在线' : '标记失联'}
                        </Button>
                      </Group>
                    </Card>
                  );
                })}
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Card withBorder h="100%">
              <Title order={3}>任务变更演示 · 单位/区一变即失效重算</Title>
              <List mt="md" spacing="sm">
                {scheduled.filter((m) => m.status !== 'closed').map((mission) => (
                  <List.Item
                    key={mission.id}
                    icon={
                      <ThemeIcon color={mission.status === 'queued' ? 'orange' : 'teal'} size={20} radius="xl">
                        {mission.status === 'queued' ? '队' : '执'}
                      </ThemeIcon>
                    }
                  >
                    <Group justify="space-between">
                      <div>
                        <b>{mission.bizNo} · {mission.title}</b>
                        <Text size="xs" c="dimmed">
                          当前：{state.assets.filter((a) => mission.assetIds.includes(a.id)).map((a) => a.name).join('、')}
                        </Text>
                      </div>
                      <Group gap={6}>
                        {mission.assetIds.includes('ship-01') ? (
                          <Button
                            size="compact-xs"
                            variant="light"
                            onClick={() =>
                              state.reviseMission(mission.id, {
                                assetIds: mission.assetIds.filter((id) => id !== 'ship-01').concat(mission.assetIds.includes('heli-02') ? [] : ['heli-02'])
                              })
                            }
                          >
                            换成直升机
                          </Button>
                        ) : (
                          <Button
                            size="compact-xs"
                            variant="light"
                            onClick={() =>
                              state.reviseMission(mission.id, {
                                assetIds: mission.assetIds.filter((id) => id !== 'heli-02').concat('ship-01')
                              })
                            }
                          >
                            换成海巡071
                          </Button>
                        )}
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="gray"
                          onClick={() =>
                            state.reviseMission(mission.id, {
                              areaId: mission.areaId === 'area-a' ? 'area-b' : 'area-a'
                            })
                          }
                        >
                          改派{mission.areaId === 'area-a' ? 'B区' : 'A区'}
                        </Button>
                      </Group>
                    </Group>
                  </List.Item>
                ))}
              </List>
              <Text size="xs" c="dimmed" mt="md">
                变更后任务 rev+1、原占用释放，容量排队与覆盖率立即按新单位/新区和不可变航迹重算；旧航迹记为"原占用失效"。
              </Text>
            </Card>
          </Grid.Col>
        </Grid>

        <LedgerRowsCard />

        <Card withBorder>
          <Title order={3}>联合事件时间线（记账/排队/合并留痕）</Title>
          <Text size="xs" c="dimmed" mt={4}>当前责任账合计主责航迹格 {totalPrimary} 个</Text>
          <Timeline mt="lg" active={1} bulletSize={18} lineWidth={2}>
            {state.events.slice(0, 14).map((event) => (
              <Timeline.Item key={event.id} title={`${event.actor} · ${format(new Date(event.time), 'MM-dd HH:mm')}`}>
                <Group gap={6}>
                  <Badge size="xs" color={KIND_COLOR[event.kind ?? 'plan'] ?? 'gray'} variant="light">
                    {event.kind ?? 'plan'}
                  </Badge>
                  <Text size="sm">{event.message}</Text>
                </Group>
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>
      </Stack>
    </main>
  );
}
