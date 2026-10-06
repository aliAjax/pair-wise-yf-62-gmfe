'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Grid, Group, List, MultiSelect, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, ThemeIcon, Timeline, Title } from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useMemo, useState } from 'react';
import { useCommandStore, selectCoordinations } from '@/lib/store';
import { findOverlaps, overlapKey } from '@/lib/ledger';
import { SearchMap } from '@/components/SearchMap';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  assetIds: z.array(z.string()).min(1, '至少调派一个单位'),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160)
});

const occColor: Record<string, string> = { active: 'teal', invalid: 'red', closed: 'gray' };
const occLabel: Record<string, string> = { active: '占用中', invalid: '已失效', closed: '已关闭' };

export default function CommandPage() {
  const state = useCommandStore();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['ship-01']);
  const [scopeMission, setScopeMission] = useState<string | null>(null);
  const [scopeArea, setScopeArea] = useState<string>('');
  const [scopeAssets, setScopeAssets] = useState<string[]>([]);
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<z.infer<typeof missionSchema>>({
    resolver: zodResolver(missionSchema),
    defaultValues: { title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' }
  });
  const brief = useQuery({
    queryKey: ['sea-state'],
    queryFn: async () => ({ wind: '东北风 6级', visibility: '4.2海里', tide: '涨潮' }),
    refetchInterval: state.lowBandwidth ? false : 60_000
  });

  const overlaps = useMemo(() => findOverlaps(state.areas), [state.areas]);
  const coordinations = useMemo(() => selectCoordinations(state), [state]);
  const areaName = (id: string) => state.areas.find((a) => a.id === id)?.name ?? id;
  const assetName = (id: string) => state.assets.find((a) => a.id === id)?.name ?? id;

  const submitMission = (values: z.infer<typeof missionSchema>) => {
    state.dispatchMission({ ...values, assetIds: selectedAssets });
    reset({ title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' });
  };

  const applyScope = () => {
    if (!scopeMission) return;
    state.updateMissionScope(scopeMission, { areaId: scopeArea || undefined, assetIds: scopeAssets.length ? scopeAssets : undefined });
    setScopeMission(null);
  };

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div><Badge color={state.offline ? 'red' : 'teal'}>{state.offline ? '离线缓存模式' : '联合指挥在线'}</Badge><Title order={1} className="section-title">海上搜救联合指挥</Title><Text c="dimmed">按实际航迹记账：搜索区、执行单位、任务单责任合一</Text></div>
          <Group><Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} /><Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} /></Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 4 }}>
          {[
            ['活动搜索区', state.areas.filter((item) => item.status === 'active').length],
            ['在线单位', state.assets.filter((item) => item.status !== 'offline').length],
            ['进行中任务', state.missions.filter((item) => item.status === 'in_progress').length],
            ['责任占用', state.occupations.filter((o) => o.status === 'active').length]
          ].map(([label, value]) => <Card key={String(label)} withBorder><Text size="sm" c="dimmed">{label}</Text><Title order={2}>{value}</Title></Card>)}
        </SimpleGrid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}><Card withBorder><Group justify="space-between"><Title order={3}>搜救态势</Title><Text size="sm">风况：{brief.data?.wind ?? '读取中'} · 能见度：{brief.data?.visibility ?? '--'}</Text></Group><SearchMap areas={state.areas} assets={state.assets} tracks={state.tracks} overlaps={overlaps} /></Card></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}><Card withBorder h="100%"><Title order={3}>单位状态</Title><Stack mt="md">{state.assets.map((asset) => {
            const stale = Date.now() - new Date(asset.lastSeen).getTime() > 10 * 60_000;
            return <Card key={asset.id} withBorder padding="sm"><Group justify="space-between"><b>{asset.name}</b><Badge color={asset.status === 'offline' ? 'red' : asset.status === 'assigned' ? 'blue' : 'teal'}>{asset.status}</Badge></Group><Text size="xs" c={stale ? 'red' : 'dimmed'}>{stale ? '位置已过期 · ' : ''}{formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}</Text><Group mt="xs"><Button size="compact-xs" variant="light" onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}>{asset.status === 'offline' ? '恢复在线' : '标记失联'}</Button></Group></Card>;
          })}</Stack></Card></Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}><Card withBorder><Title order={3}>派发新任务</Title><form onSubmit={handleSubmit(submitMission)}><Stack mt="md"><TextInput label="任务名称" {...register('title')} error={errors.title?.message} /><label>搜索区<select {...register('areaId')} style={{ width: '100%', padding: 8 }}>{state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>调派单位（可多选）<select multiple value={selectedAssets} onChange={(event) => setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} style={{ width: '100%', minHeight: 86 }}>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}（容量 {asset.capacity}）</option>)}</select></label><label>优先级<select {...register('priority')} style={{ width: '100%', padding: 8 }}><option value="urgent">紧急</option><option value="normal">常规</option></select></label><Textarea label="任务说明" {...register('note')} /><Button type="submit">派发任务</Button></Stack></form></Card></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}><Card withBorder><Title order={3}>任务与搜索区</Title><Table mt="md"><thead><tr><th>搜索区</th><th>状态</th><th>覆盖率（按实际航迹）</th></tr></thead><tbody>{state.areas.map((area) => <tr key={area.id}><td>{area.name}</td><td>{area.status}</td><td style={{ width: '42%' }}><Progress value={area.coverage} /></td></tr>)}</tbody></Table><List mt="lg" spacing="sm">{state.missions.map((mission) => <List.Item key={mission.id}><Group justify="space-between"><div><b>{mission.title}</b><Text size="xs" c="dimmed">{mission.businessNo} · {areaName(mission.areaId)} · {mission.assetIds.map(assetName).join(' / ')}</Text></div><Group><Badge>{mission.status}</Badge><Button size="compact-xs" variant="light" onClick={() => state.setMissionStatus(mission.id, mission.status === 'closed' ? 'in_progress' : 'closed')}>{mission.status === 'closed' ? '重开' : '关闭'}</Button></Group></Group></List.Item>)}</List></Card></Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Card withBorder><Title order={3}>责任账</Title><Text size="xs" c="dimmed" mt={4}>同一单位同一时段只计入一个搜索区；共享带航迹归主责区，另一区算协同。</Text>
              <Table mt="md"><thead><tr><th>单位</th><th>搜索区</th><th>业务编号</th><th>状态</th><th>说明</th></tr></thead><tbody>
                {state.occupations.length === 0 && <tr><td colSpan={5}><Text size="sm" c="dimmed">暂无占用</Text></td></tr>}
                {state.occupations.map((o) => <tr key={o.id}><td>{assetName(o.assetId)}</td><td>{areaName(o.areaId)}</td><td>{o.businessNo}</td><td><Badge color={occColor[o.status]}>{occLabel[o.status]}</Badge></td><td><Text size="xs" c="dimmed">{o.reason ?? '—'}</Text></td></tr>)}
              </tbody></Table>
              <Title order={5} mt="lg">协同记录</Title>
              <Table mt="xs"><thead><tr><th>协同区</th><th>主责区</th><th>单位</th><th>业务编号</th><th>航迹点</th></tr></thead><tbody>
                {coordinations.length === 0 && <tr><td colSpan={5}><Text size="sm" c="dimmed">暂无协同（共享带航迹并入账后生成）</Text></td></tr>}
                {coordinations.map((c, i) => <tr key={i}><td>{areaName(c.areaId)}</td><td>{areaName(c.primaryAreaId)}</td><td>{assetName(c.assetId)}</td><td>{c.businessNo}</td><td>{c.pointIds.length}</td></tr>)}
              </tbody></Table>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Stack gap="lg">
              <Card withBorder><Title order={3}>交叠水域 · 主责区</Title><Text size="xs" c="dimmed" mt={4}>交叠水域先定主责区；共享带航迹归主责区，另一区算协同。</Text>
                <Stack mt="md">{overlaps.length === 0 && <Text size="sm" c="dimmed">当前无交叠水域</Text>}
                  {overlaps.map((ov) => {
                    const key = overlapKey(ov.a.id, ov.b.id);
                    const primary = state.primaryByOverlap[key];
                    return <Group key={key} justify="space-between"><Text size="sm">{ov.a.name} ↔ {ov.b.name}</Text>
                      <Select size="xs" style={{ width: 160 }} value={primary ?? ''} onChange={(v) => v && state.setPrimaryArea(key, v)} data={[{ value: ov.a.id, label: ov.a.name }, { value: ov.b.id, label: ov.b.name }]} />
                    </Group>;
                  })}
                </Stack>
              </Card>
              <Card withBorder><Title order={3}>任务范围变更</Title><Text size="xs" c="dimmed" mt={4}>单位或搜索区一变化，原占用失效并重算覆盖率。</Text>
                <Stack mt="md">
                  <Select size="xs" label="选择任务" value={scopeMission} onChange={setScopeMission} data={state.missions.map((m) => ({ value: m.id, label: m.title }))} />
                  <Select size="xs" label="变更搜索区" value={scopeArea} onChange={(v) => setScopeArea(v ?? '')} data={state.areas.map((a) => ({ value: a.id, label: a.name }))} />
                  <MultiSelect size="xs" label="变更调派单位" value={scopeAssets} onChange={setScopeAssets} data={state.assets.map((a) => ({ value: a.id, label: a.name }))} />
                  <Button size="xs" variant="light" onClick={applyScope}>应用变更</Button>
                </Stack>
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Card withBorder><Title order={3}>航迹模拟回传</Title><Text size="xs" c="dimmed" mt={4}>船艇、无人机实际飞偏或漏飞时回传航迹；按实际航迹重算覆盖率。</Text>
              <Stack mt="md">{state.missions.filter((m) => m.status !== 'closed').map((mission) =>
                <Group key={mission.id} justify="space-between"><div><Text size="sm">{mission.title}</Text><Text size="xs" c="dimmed">{mission.businessNo} · {areaName(mission.areaId)}</Text></div>
                  <Group><Button size="compact-xs" variant="light" onClick={() => state.simulateOnlineTrack(mission.id)}>在线航迹</Button><Button size="compact-xs" variant="outline" onClick={() => state.simulateOfflineReturn(mission.id)}>离线回传</Button></Group>
                </Group>
              )}</Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Card withBorder><Title order={3}>离线回传箱</Title><Text size="xs" c="dimmed" mt={4}>按业务编号合并；晚到的旧报告只补历史，不计覆盖率。</Text>
              <Stack mt="md">
                {state.offlineReports.length === 0 && <Text size="sm" c="dimmed">回传箱为空</Text>}
                {state.offlineReports.map((r) => <Card key={r.id} withBorder padding="xs"><Group justify="space-between"><div><Text size="sm">{r.businessNo} · {assetName(r.assetId)}</Text><Text size="xs" c="dimmed">{r.points.length} 点 · {formatDistanceToNow(new Date(r.receivedAt), { addSuffix: true, locale: zhCN })}</Text></div><Group>{r.late && <Badge color="orange">晚到·只补历史</Badge>}{r.merged && <Badge color="teal">已合并</Badge>}</Group></Group></Card>)}
                <Button size="xs" variant="light" onClick={state.mergeOfflineReports} disabled={!state.offlineReports.some((r) => !r.merged)}>合并回传（按业务编号）</Button>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        {state.queue.length > 0 && (
          <Card withBorder><Group justify="space-between"><Title order={3}>容量队列</Title><Button size="xs" variant="light" onClick={state.promoteFromQueue}>腾出容量后派发</Button></Group>
            <Table mt="md"><thead><tr><th>业务编号</th><th>单位</th><th>搜索区</th><th>原因</th></tr></thead><tbody>
              {state.queue.map((q) => <tr key={q.id}><td>{q.businessNo}</td><td>{assetName(q.assetId)}</td><td>{areaName(q.areaId)}</td><td><Badge color="orange">超出同时段容量</Badge></td></tr>)}
            </tbody></Table>
          </Card>
        )}

        <Card withBorder><Title order={3}>联合事件时间线</Title><Timeline mt="lg" active={1} bulletSize={18} lineWidth={2}>{state.events.slice(0, 10).map((event) => <Timeline.Item key={event.id} title={`${event.actor} · ${new Date(event.time).toLocaleTimeString()}`}><Text size="sm">{event.message}</Text></Timeline.Item>)}</Timeline></Card>
      </Stack>
    </main>
  );
}
