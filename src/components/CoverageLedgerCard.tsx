'use client';

import { Badge, Button, Card, Group, Progress, Select, Stack, Table, Text, Title } from '@mantine/core';
import { format } from 'date-fns';
import { useCommandStore } from '@/lib/store';
import { useLedger } from '@/lib/useLedger';
import type { LedgerRow, SharedBelt } from '@/lib/types';

const SOURCE_LABEL: Record<LedgerRow['source'], string> = {
  live: '实时',
  'offline-merge': '离线合并',
  'late-backfill': '晚到补历史'
};

const SOURCE_COLOR: Record<LedgerRow['source'], string> = {
  live: 'teal',
  'offline-merge': 'blue',
  'late-backfill': 'gray'
};

export function CoverageLedgerCard() {
  const store = useCommandStore();
  const { areaStats, unownedBeltWarnings, rows } = useLedger();
  const areaName = (id: string) => store.areas.find((a) => a.id === id)?.name ?? id;
  const detachedCount = rows.filter((r) => r.detached).length;

  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={3}>责任账 · 按实际航迹的覆盖率</Title>
        <Button size="compact-xs" variant="light" onClick={store.resetDemo}>重置演示数据</Button>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        15分钟为一个记账时段；同一单位同一时段只有一个主责区，交叠带归主责、另一区计协同。区/单位一变化，原占用失效并按航迹重算。
      </Text>

      {unownedBeltWarnings.length > 0 && (
        <Card mt="sm" padding="sm" withBorder color="red">
          <Text size="sm" c="red" fw={700}>⚠ {unownedBeltWarnings.reduce((n, w) => n + w.beltCells, 0)} 个航迹格落入未定主责的交叠水域</Text>
          {unownedBeltWarnings.map((w) => (
            <Text key={w.areaIds.join('|')} size="xs" c="red">
              {w.areaIds.map(areaName).join(' × ')}：{w.beltCells} 格暂不计账，请先定主责
            </Text>
          ))}
        </Card>
      )}

      <Table mt="md" verticalSpacing="sm">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>搜索区</th>
            <th style={{ textAlign: 'left', width: '34%' }}>主责覆盖率（实际航迹）</th>
            <th style={{ textAlign: 'left' }}>协同覆盖</th>
            <th style={{ textAlign: 'left' }}>主责格/总格</th>
            <th style={{ textAlign: 'left' }}>版本</th>
          </tr>
        </thead>
        <tbody>
          {areaStats.map((stat) => {
            const area = store.areas.find((a) => a.id === stat.areaId);
            const lateExtra = Math.max(0, Math.round((stat.primaryPercentWithLate - stat.primaryPercent) * 10) / 10);
            return (
              <tr key={stat.areaId}>
                <td>
                  <b>{areaName(stat.areaId)}</b>
                  <div><Badge size="xs" variant="light" color={area?.status === 'active' ? 'teal' : 'gray'}>{area?.status}</Badge></div>
                </td>
                <td>
                  <Progress.Root size="xl">
                    <Progress.Section value={stat.primaryPercent} color="teal" />
                    {lateExtra > 0 && <Progress.Section value={Math.min(100 - stat.primaryPercent, lateExtra)} color="gray" />}
                  </Progress.Root>
                  <Text size="xs" c="dimmed">
                    {stat.primaryPercent}%{lateExtra > 0 ? `（含晚到补记后 ${stat.primaryPercentWithLate}%）` : ''}
                  </Text>
                </td>
                <td>
                  <Text size="sm">{stat.cooperationPercent}%</Text>
                  <Text size="xs" c="dimmed">他区飞偏/共享带协同</Text>
                </td>
                <td><Text size="sm">{stat.primaryCells} / {stat.totalCells}</Text></td>
                <td>
                  {stat.revised ? <Badge color="orange">已重算 rev{area?.rev}</Badge> : <Badge variant="light">rev{area?.rev}</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {detachedCount > 0 && (
        <Text size="xs" c="orange" mt="sm">另有 {detachedCount} 个失效时段（单位/搜索区已变更的旧航迹），仅留痕、不计入当前主责覆盖率。</Text>
      )}
    </Card>
  );
}

export function SharedBeltsCard() {
  const store = useCommandStore();
  const assign = (belt: SharedBelt, owner: string) => {
    store.assignBeltOwner(belt.id, owner);
  };

  return (
    <Card withBorder h="100%">
      <Title order={3}>交叠水域 · 先定主责</Title>
      <Text size="xs" c="dimmed" mt={4}>带内航迹只计主责区，另一区算协同；改派主责即按航迹重算覆盖率。</Text>
      <Stack mt="md" gap="sm">
        {store.belts.length === 0 && <Text size="sm" c="dimmed">当前搜索区无交叠</Text>}
        {store.belts.map((belt) => (
          <Card key={belt.id} withBorder padding="sm">
            <Group justify="space-between">
              <Text size="sm" fw={600}>{belt.areaIds.map((id) => store.areas.find((a) => a.id === id)?.name ?? id).join(' × ')}</Text>
              {belt.backfilled && <Badge color="violet" size="xs">历史回填</Badge>}
            </Group>
            <Group mt="xs" grow>
              <Select
                size="xs"
                label="主责区"
                value={belt.ownerAreaId || null}
                placeholder="未定主责"
                data={belt.areaIds.map((id) => ({
                  value: id,
                  label: store.areas.find((a) => a.id === id)?.name ?? id
                }))}
                onChange={(v) => v && assign(belt, v)}
                error={!belt.ownerAreaId ? '交叠点暂不计账' : undefined}
              />
            </Group>
            {belt.note && <Text size="xs" c="dimmed" mt={4}>{belt.note}</Text>}
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
