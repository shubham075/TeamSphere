import { LOBBY_BYPASS, POLICY_SCHEMAS, POLICY_TYPES } from '@teamsphere/shared';
import type { EffectivePolicies, EffectivePolicySource, PolicyType } from '@teamsphere/shared';

/** Pure policy resolution, kept free of Prisma so it can be unit-tested. */

export interface PolicyCandidate {
  id: string;
  type: string;
  name: string;
  settings: unknown;
  via: 'user' | 'team' | 'default';
}

/** Settings of one type with defaults filled in; unknown keys dropped, bad values replaced by defaults. */
export function normalizeSettings<T extends PolicyType>(type: T, raw: unknown): EffectivePolicies[T] {
  const schema = POLICY_SCHEMAS[type];
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data as EffectivePolicies[T];
  // Keep the valid keys of a partially broken row rather than resetting everything.
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const one = (field as { safeParse(v: unknown): { success: boolean; data?: unknown } }).safeParse(obj[key]);
    out[key] = one.success ? one.data : (field as { parse(v: unknown): unknown }).parse(undefined);
  }
  return out as EffectivePolicies[T];
}

/** Lower is stricter (fewer people skip the lobby). */
const LOBBY_RANK: Record<(typeof LOBBY_BYPASS)[number], number> = { organizers: 0, invited: 1, everyone: 2 };

/**
 * Several team policies of the same type: the most restrictive value of each setting wins (a feature is on only if
 * every team allows it), so joining a team can never quietly loosen what another team's policy restricts.
 */
export function combineRestrictive<T extends PolicyType>(type: T, list: EffectivePolicies[T][]): EffectivePolicies[T] {
  const out: Record<string, unknown> = { ...list[0] };
  for (const next of list.slice(1) as Record<string, unknown>[]) {
    for (const [key, value] of Object.entries(next)) {
      const cur = out[key];
      if (typeof value === 'boolean') out[key] = (cur as boolean) && value;
      else if (key === 'lobbyDefault') {
        out[key] = LOBBY_RANK[value as keyof typeof LOBBY_RANK] < LOBBY_RANK[cur as keyof typeof LOBBY_RANK] ? value : cur;
      }
    }
  }
  return normalizeSettings(type, out);
}

/**
 * Effective policies for one person. Per type: a policy assigned to the user directly wins; otherwise the policies
 * of their teams (combined restrictively); otherwise the org default; otherwise the built-in defaults (everything on).
 */
export function resolvePolicies(candidates: PolicyCandidate[]): { effective: EffectivePolicies; sources: EffectivePolicySource[] } {
  const effective = {} as Record<PolicyType, unknown>;
  const sources: EffectivePolicySource[] = [];
  for (const type of POLICY_TYPES) {
    const ofType = candidates.filter((c) => c.type === type);
    const direct = ofType.filter((c) => c.via === 'user');
    const team = ofType.filter((c) => c.via === 'team');
    const fallback = ofType.find((c) => c.via === 'default');
    if (direct.length) {
      // Unique per (policy, user), but one user can be in two policies of a type; pick the first by name for stability.
      const pick = [...direct].sort((a, b) => a.name.localeCompare(b.name))[0];
      effective[type] = normalizeSettings(type, pick.settings);
      sources.push({ type, policyId: pick.id, policyName: pick.name, via: 'user' });
    } else if (team.length) {
      const sorted = [...team].sort((a, b) => a.name.localeCompare(b.name));
      effective[type] = combineRestrictive(type, sorted.map((c) => normalizeSettings(type, c.settings)));
      sources.push({ type, policyId: sorted[0].id, policyName: sorted.map((c) => c.name).join(', '), via: 'team' });
    } else if (fallback) {
      effective[type] = normalizeSettings(type, fallback.settings);
      sources.push({ type, policyId: fallback.id, policyName: fallback.name, via: 'default' });
    } else {
      effective[type] = normalizeSettings(type, {});
      sources.push({ type, policyId: null, policyName: null, via: 'builtin' });
    }
  }
  return { effective: effective as unknown as EffectivePolicies, sources };
}

/** Upload limit actually enforced: the org setting, never above the endpoint's hard limit. */
export function uploadLimitBytes(maxFileSizeMb: number, hardLimitBytes: number): number {
  return Math.min(maxFileSizeMb * 1024 * 1024, hardLimitBytes);
}
