import type {
  MerchantProfile,
  EntityGraph,
  GraphNode,
  GraphEdge,
} from "@/types/domain";
import type { KnownBadEntity } from "@/data/generator";
import { clamp, round } from "@/utils/stats";

export interface SharedInfraIndex {
  byBank: Map<string, string[]>;
  byIp: Map<string, string[]>;
  byDevice: Map<string, string[]>;
  byOwner: Map<string, string[]>;
  facilitatorSubmerchants: Map<string, string[]>;
}

export function buildInfraIndex(merchants: MerchantProfile[]): SharedInfraIndex {
  const byBank = new Map<string, string[]>();
  const byOwner = new Map<string, string[]>();
  const byIp = new Map<string, string[]>();
  const byDevice = new Map<string, string[]>();
  const facilitatorSubmerchants = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    const arr = map.get(key) ?? [];
    arr.push(id);
    map.set(key, arr);
  };
  for (const m of merchants) {
    push(byBank, m.settlementBankAccountId, m.merchantId);
    push(byOwner, m.beneficialOwnerId, m.merchantId);
    for (const ip of m.ipClusterIds) push(byIp, ip, m.merchantId);
    for (const d of m.deviceIds) push(byDevice, d, m.merchantId);
    if (m.paymentFacilitatorId) push(facilitatorSubmerchants, m.paymentFacilitatorId, m.merchantId);
  }
  return { byBank, byIp, byDevice, byOwner, facilitatorSubmerchants };
}

export interface MerchantGraphMetrics {
  sharedBankAccountCount: number;
  sharedIpCount: number;
  sharedDeviceCount: number;
  submerchantCount: number;
  knownBadAdjacency: number; // 0..1 distance-weighted
  graphScore: number;
}

export function computeGraphMetrics(
  m: MerchantProfile,
  idx: SharedInfraIndex,
  knownBad: KnownBadEntity[],
): MerchantGraphMetrics {
  const badBanks = new Set(knownBad.filter((k) => k.kind === "bank").map((k) => k.id));
  const badIps = new Set(knownBad.filter((k) => k.kind === "ip").map((k) => k.id));
  const badDevs = new Set(knownBad.filter((k) => k.kind === "device").map((k) => k.id));
  const badOwners = new Set(knownBad.filter((k) => k.kind === "owner").map((k) => k.id));

  const sharedBank = Math.max(0, (idx.byBank.get(m.settlementBankAccountId)?.length ?? 1) - 1);
  const sharedIp = Math.max(
    0,
    m.ipClusterIds.reduce((a, ip) => a + Math.max(0, (idx.byIp.get(ip)?.length ?? 1) - 1), 0),
  );
  const sharedDevice = Math.max(
    0,
    m.deviceIds.reduce((a, d) => a + Math.max(0, (idx.byDevice.get(d)?.length ?? 1) - 1), 0),
  );
  const submerchantCount =
    m.merchantType === "facilitator" && m.paymentFacilitatorId
      ? idx.facilitatorSubmerchants.get(m.paymentFacilitatorId)?.length ?? 0
      : 0;

  let adjacency = 0;
  if (badBanks.has(m.settlementBankAccountId)) adjacency = Math.max(adjacency, 1);
  if (badOwners.has(m.beneficialOwnerId)) adjacency = Math.max(adjacency, 1);
  if (m.ipClusterIds.some((ip) => badIps.has(ip))) adjacency = Math.max(adjacency, 0.85);
  if (m.deviceIds.some((d) => badDevs.has(d))) adjacency = Math.max(adjacency, 0.85);

  const graphScore = clamp(
    18 * Math.min(sharedBank, 3) +
      6 * Math.min(sharedIp, 4) +
      6 * Math.min(sharedDevice, 4) +
      4 * Math.min(submerchantCount, 10) +
      55 * adjacency,
  );

  return {
    sharedBankAccountCount: sharedBank,
    sharedIpCount: sharedIp,
    sharedDeviceCount: sharedDevice,
    submerchantCount,
    knownBadAdjacency: round(adjacency, 3),
    graphScore: round(graphScore, 1),
  };
}

// Build a bounded entity graph for the investigation / factoring explorer.
export function buildMerchantGraph(
  m: MerchantProfile,
  merchants: Map<string, MerchantProfile>,
  idx: SharedInfraIndex,
  knownBad: KnownBadEntity[],
  merchantRisk: (id: string) => number,
): EntityGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const badIds = new Set(knownBad.map((k) => k.id));

  const addNode = (n: GraphNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (source: string, target: string, type: string) => {
    edges.push({ source, target, type });
  };

  addNode({ id: m.merchantId, type: "merchant", label: m.tradeName, risk: merchantRisk(m.merchantId) });

  // Direct infrastructure.
  addNode({ id: m.settlementBankAccountId, type: "bank", label: m.settlementBankAccountId, risk: badIds.has(m.settlementBankAccountId) ? 95 : 20, known_bad: badIds.has(m.settlementBankAccountId) });
  addEdge(m.merchantId, m.settlementBankAccountId, "settles-to");
  addNode({ id: m.beneficialOwnerId, type: "owner", label: m.beneficialOwnerId, risk: badIds.has(m.beneficialOwnerId) ? 95 : 25, known_bad: badIds.has(m.beneficialOwnerId) });
  addEdge(m.merchantId, m.beneficialOwnerId, "owned-by");
  addNode({ id: m.registeredAddressId, type: "address", label: m.registeredAddressId, risk: 15 });
  addEdge(m.merchantId, m.registeredAddressId, "uses-address");
  addNode({ id: m.websiteDomain, type: "domain", label: m.websiteDomain, risk: 20 });
  addEdge(m.merchantId, m.websiteDomain, "uses-domain");
  if (m.acquirerId) {
    addNode({ id: m.acquirerId, type: "acquirer", label: m.acquirerId, risk: 12 });
    addEdge(m.merchantId, m.acquirerId, "processes-through");
  }
  if (m.paymentFacilitatorId) {
    addNode({ id: m.paymentFacilitatorId, type: "facilitator", label: m.paymentFacilitatorId, risk: 30 });
    addEdge(m.merchantId, m.paymentFacilitatorId, "processes-through");
  }
  for (const d of m.descriptor ? [m.descriptor, ...m.alternateDescriptors] : []) {
    const id = `DESC:${d}`;
    addNode({ id, type: "descriptor", label: d, risk: 22 });
    addEdge(m.merchantId, id, "shares-descriptor");
  }
  for (const ip of m.ipClusterIds.slice(0, 4)) {
    addNode({ id: ip, type: "ip", label: ip, risk: badIds.has(ip) ? 92 : 18, known_bad: badIds.has(ip) });
    addEdge(m.merchantId, ip, "uses-ip");
  }
  for (const d of m.deviceIds.slice(0, 4)) {
    addNode({ id: d, type: "device", label: d, risk: badIds.has(d) ? 92 : 18, known_bad: badIds.has(d) });
    addEdge(m.merchantId, d, "uses-device");
  }

  // Neighbor merchants sharing bank / ip / device.
  const neighbors = new Set<string>();
  for (const other of idx.byBank.get(m.settlementBankAccountId) ?? []) if (other !== m.merchantId) neighbors.add(other);
  for (const ip of m.ipClusterIds)
    for (const other of idx.byIp.get(ip) ?? []) if (other !== m.merchantId) neighbors.add(other);
  for (const d of m.deviceIds)
    for (const other of idx.byDevice.get(d) ?? []) if (other !== m.merchantId) neighbors.add(other);

  let added = 0;
  for (const nid of neighbors) {
    if (added >= 8) break;
    const other = merchants.get(nid);
    if (!other) continue;
    addNode({ id: other.merchantId, type: "merchant", label: other.tradeName, risk: merchantRisk(other.merchantId) });
    if (other.settlementBankAccountId === m.settlementBankAccountId)
      addEdge(other.merchantId, m.settlementBankAccountId, "settles-to");
    for (const ip of other.ipClusterIds) if (m.ipClusterIds.includes(ip)) addEdge(other.merchantId, ip, "uses-ip");
    for (const d of other.deviceIds) if (m.deviceIds.includes(d)) addEdge(other.merchantId, d, "uses-device");
    added++;
  }

  // Submerchants for facilitators.
  if (m.merchantType === "facilitator" && m.paymentFacilitatorId) {
    const subs = idx.facilitatorSubmerchants.get(m.paymentFacilitatorId) ?? [];
    for (const sid of subs.slice(0, 8)) {
      if (sid === m.merchantId) continue;
      const sub = merchants.get(sid);
      if (!sub) continue;
      addNode({ id: sub.merchantId, type: "merchant", label: sub.tradeName, risk: merchantRisk(sub.merchantId), meta: { role: "submerchant" } });
      addEdge(m.paymentFacilitatorId, sub.merchantId, "processes-through");
    }
  }

  return { nodes: [...nodes.values()], edges };
}
