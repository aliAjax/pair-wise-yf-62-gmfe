'use client';

import { Badge, Button, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { format } from 'date-fns';
import { useCommandStore } from '@/lib/store';
import { useLedger } from '@/lib/useLedger';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  dispatched: '已派发',
  queued: '排队中',
  in_progress: '执行中',
  closed: '已关闭'
};

export function MissionQueueCard() {
  const store = useCommandStore();
  const { scheduled } = useLedger();
  const assetName = (id: string) => store.assets.find((a) => a.id === id)?.name ?? id;
  const areaName = (id: string) => store.areas.find((a) => a.id === id)?.name ?? id;

  return (
    <Card withBorder h="100%">
      <Title order={3}>任务单 · 容量与排队</Title>
      <Text size="xs" c="dimmed" mt={4}>
        计划时段重叠且单位同时段占用达到容量即排队；关闭任务或调高容量后按 紧急 &gt; 开始时间 自动递补。
      </Text>
      <Stack mt="md" gap="sm">
        {scheduled.map((m) => (
          <Card key={m.id} withBorder padding="sm">
            <Group justify="space-between" align="flex-start">
              <div>
                <Group gap="xs">
                  <Text fw={600} size="sm">{m.bizNo} · {m.title}</Text>
                  {m.priority === 'urgent' && <Badge color="red" size="xs">紧急</Badge>}
                  <Badge color={m.status === 'queued' ? 'orange' : m.status === 'closed' ? 'gray' : 'teal'} size="xs">
                    {STATUS_LABEL[m.status]}
                  </Badge>
                  {m.rev > 1 && <Badge color="violet" size="xs">占用已重置 rev{m.rev}</Badge>}
                </Group>
                <Text size="xs" c="dimmed" mt={4}>
                  {areaName(m.areaId)} · {m.assetIds.map(assetName).join('、')}
                </Text>
                <Text size="xs" c="dimmed">
                  {format(new Date(m.windowStart), 'MM-dd HH:mm')} – {format(new Date(m.windowEnd), 'HH:mm')}
                </Text>
                {m.queuedReason && <Text size="xs" c="orange" mt={2}>{m.queuedReason}</Text>}
                {m.closedAt && <Text size="xs" c="dimmed" mt={2}>已关闭于 {format(new Date(m.closedAt), 'MM-dd HH:mm')}，此后回传只补历史</Text>}
              </div>
              <Group gap={4}>
                {m.status !== 'in_progress' && m.status !== 'closed' && (
                  <Button size="compact-xs" variant="light" onClick={() => store.setMissionStatus(m.id, 'in_progress')}>开始</Button>
                )}
                {m.status !== 'closed' && (
                  <Button size="compact-xs" color="gray" variant="light" onClick={() => store.setMissionStatus(m.id, 'closed')}>关闭</Button>
                )}
                {m.status === 'closed' && (
                  <Button size="compact-xs" variant="light" onClick={() => store.setMissionStatus(m.id, 'dispatched')}>重开</Button>
                )}
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}

export function CapacityCard() {
  const store = useCommandStore();
  return (
    <Card withBorder>
      <Title order={4}>单位同时段容量</Title>
      <Table mt="sm">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>单位</th>
            <th style={{ textAlign: 'left' }}>容量</th>
            <th style={{ textAlign: 'left' }}></th>
          </tr>
        </thead>
        <tbody>
          {store.assets.map((a) => (
            <tr key={a.id}>
              <td><Text size="sm">{a.name}</Text></td>
              <td><Text size="sm">{a.concurrentCapacity}</Text></td>
              <td>
                <Group gap={4} justify="flex-end">
                  <Button size="compact-xs" variant="light" onClick={() => store.setCapacity(a.id, a.concurrentCapacity - 1)}>−</Button>
                  <Button size="compact-xs" variant="light" onClick={() => store.setCapacity(a.id, a.concurrentCapacity + 1)}>＋</Button>
                </Group>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
