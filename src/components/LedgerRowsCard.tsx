'use client';

import { Badge, Button, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { format } from 'date-fns';
import { useCommandStore } from '@/lib/store';
import { useLedger } from '@/lib/useLedger';
import type { TrackReport } from '@/lib/types';

const SOURCE_LABEL = {
  live: '实时',
  'offline-merge': '离线合并',
  'late-backfill': '晚到补历史'
} as const;

const SOURCE_COLOR = {
  live: 'teal',
  'offline-merge': 'blue',
  'late-backfill': 'gray'
} as const;

export function LedgerRowsCard() {
  const store = useCommandStore();
  const { rows, gaps } = useLedger();
  const assetName = (id: string) => store.assets.find((a) => a.id === id)?.name ?? id;
  const areaName = (id: string) => store.areas.find((a) => a.id === id)?.name ?? id;

  const visible = [...rows]
    .sort((a, b) => b.slotStart.localeCompare(a.slotStart))
    .slice(0, 24);

  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={3}>逐时段责任账</Title>
        <Text size="xs" c="dimmed">
          漏飞时段 {gaps.length} 个 · 失效时段 {rows.filter((r) => r.detached).length} 个
        </Text>
      </Group>
      <Table mt="md" style={{ fontSize: 12 }} horizontalSpacing="sm" verticalSpacing="sm" striped>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>时段</th>
            <th style={{ textAlign: 'left' }}>业务编号/单位</th>
            <th style={{ textAlign: 'left' }}>主责区（唯一）</th>
            <th style={{ textAlign: 'right' }}>主责格</th>
            <th style={{ textAlign: 'right' }}>协同格</th>
            <th style={{ textAlign: 'right' }}>飞偏</th>
            <th style={{ textAlign: 'left' }}>来源</th>
            <th style={{ textAlign: 'left' }}>状态</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const coopCount = Object.values(r.cooperationCells).reduce((n, cells) => n + cells.length, 0);
            const isGap = gaps.some((g) => g.assetId === r.assetId && g.slotStart === r.slotStart && g.bizNo === r.bizNo);
            const lateCount = r.latePrimaryCells.length;
            return (
              <tr key={r.key} style={{ opacity: r.detached ? 0.6 : 1 }}>
                <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(r.slotStart), 'MM-dd HH:mm')}</td>
                <td>
                  <Text size="xs">{r.bizNo}<br /><span style={{ color: '#868e96' }}>{assetName(r.assetId)}</span></Text>
                </td>
                <td>{r.ownerAreaId ? areaName(r.ownerAreaId) : <Text c="orange" size="xs">已失效</Text>}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.primaryCells.length}
                  {lateCount > 0 && <Text component="span" c="gray" size="xs">（补{lateCount}）</Text>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {coopCount > 0 ? (
                    <Text size="xs" c="blue" title={Object.entries(r.cooperationCells).map(([id, c]) => `${areaName(id)}:${c.length}`).join('；')}>
                      {coopCount}
                    </Text>
                  ) : 0}
                </td>
                <td style={{ textAlign: 'right' }}>{r.outsideCells > 0 ? <Text c="orange" size="xs">{r.outsideCells}</Text> : 0}</td>
                <td><Badge size="xs" color={SOURCE_COLOR[r.source]}>{SOURCE_LABEL[r.source]}</Badge></td>
                <td>
                  {r.detached && <Badge size="xs" color="orange">原占用失效</Badge>}
                  {!r.detached && isGap && <Badge size="xs" color="red">漏飞</Badge>}
                  {!r.detached && !isGap && r.unownedCells.length > 0 && <Badge size="xs" color="red">带未定主责</Badge>}
                  {!r.detached && !isGap && r.unownedCells.length === 0 && r.primaryCells.length > 0 && (
                    <Badge size="xs" color="teal">已记账</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

export function ReportsCard() {
  const store = useCommandStore();
  const { tracks } = useLedger();
  const assetName = (id: string) => store.assets.find((a) => a.id === id)?.name ?? id;

  const ingest = (reports: TrackReport[]) => store.ingestReports(reports);

  const simulateLiveShip = () => {
    const now = Date.now();
    const t = (offMin: number) => new Date(now + offMin * 60_000).toISOString();
    ingest([
      {
        reportId: `live-ship-${now}`,
        bizNo: 'SAR-2601',
        assetId: 'ship-01',
        points: [
          { t: t(-1), lng: 121.56, lat: 30.74 },
          { t: t(0), lng: 121.58, lat: 30.76 },
          { t: t(1), lng: 121.6, lat: 30.78 }
        ],
        sentAt: t(0),
        offline: false
      }
    ]);
  };

  const simulateOfflineDrone = () => {
    const now = Date.now();
    const t = (offMin: number) => new Date(now + offMin * 60_000).toISOString();
    // 同一业务编号两个分片，分两次"恢复回传"
    ingest([
      {
        reportId: `off-drone-a-${now}`,
        bizNo: 'SAR-2603',
        assetId: 'heli-02',
        points: [
          { t: t(-12), lng: 121.655, lat: 30.84 },
          { t: t(-9), lng: 121.66, lat: 30.85 }
        ],
        sentAt: t(-8),
        offline: true,
        chunkIndex: 0,
        chunkTotal: 2
      }
    ]);
    setTimeout(() => {
      ingest([
        {
          reportId: `off-drone-b-${now}`,
          bizNo: 'SAR-2603',
          assetId: 'heli-02',
          points: [
            { t: t(-6), lng: 121.665, lat: 30.86 },
            { t: t(-3), lng: 121.67, lat: 30.875 }
          ],
          sentAt: t(0),
          offline: true,
          chunkIndex: 1,
          chunkTotal: 2
        }
      ]);
    }, 400);
  };

  const simulateLateReport = () => {
    const now = Date.now();
    const closed = store.missions.find((m) => m.bizNo === 'SAR-2598');
    if (!closed?.closedAt) return;
    const base = new Date(closed.closedAt).getTime() + 30 * 60_000;
    ingest([
      {
        reportId: `late-${now}`,
        bizNo: 'SAR-2598',
        assetId: 'drone-04',
        points: [
          { t: new Date(base - 10 * 60_000).toISOString(), lng: 121.88, lat: 30.99 },
          { t: new Date(base - 5 * 60_000).toISOString(), lng: 121.9, lat: 31.02 }
        ],
        sentAt: new Date(base).toISOString(),
        offline: true
      }
    ]);
  };

  return (
    <Card withBorder h="100%">
      <Title order={3}>航迹回传与离线合并</Title>
      <Text size="xs" c="dimmed" mt={4}>
        报告按 reportId 幂等、按业务编号+单位合并分片；任务关闭后到达的旧报告只补历史。
      </Text>
      <Group mt="sm" gap="xs">
        <Button size="compact-xs" onClick={simulateLiveShip}>模拟实时回传</Button>
        <Button size="compact-xs" variant="light" onClick={simulateOfflineDrone}>模拟离线分片</Button>
        <Button size="compact-xs" variant="light" color="gray" onClick={simulateLateReport}>模拟晚到旧报告</Button>
      </Group>
      <Stack mt="md" gap="xs">
        {tracks.map((track) => (
          <Card key={`${track.bizNo}|${track.assetId}`} withBorder padding="sm">
            <Group justify="space-between">
              <Text size="sm" fw={600}>{track.bizNo} · {assetName(track.assetId)}</Text>
              <Group gap={4}>
                {track.offline && <Badge size="xs" color="blue">离线</Badge>}
                {track.latePointKeys.length > 0 && <Badge size="xs" color="gray">晚到{track.latePointKeys.length}点</Badge>}
              </Group>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              {track.points.length} 点 · 合并报告 {track.reportIds.length} 份（{track.reportIds.join(', ')}）
            </Text>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
