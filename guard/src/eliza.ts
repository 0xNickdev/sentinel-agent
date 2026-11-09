// ElizaOS adapter (@elizaos/core 1.x). Two pieces:
//   sentinelGuardPlugin(guard)        an action CHECK_TOKEN_RISK the agent can call on any Solana mint
//   guardAction(swapAction, guard)    wraps an existing buy/swap action so it cannot run on a blocked token
// Typed structurally, so this package does not depend on @elizaos/core; the objects match its Plugin and Action.
import { describe, type CheckOptions, type Decision, type Guard } from './index.js';

interface Content { text?: string; [k: string]: unknown }
interface Memory { content: Content; [k: string]: unknown }
type Callback = (response: Content) => Promise<unknown>;
interface ActionResult { text?: string; values?: Record<string, unknown>; data?: Record<string, unknown>; success: boolean; error?: string | Error }
export interface ElizaAction {
  name: string;
  description: string;
  similes?: string[];
  examples?: Array<Array<{ name: string; content: Content }>>;
  validate: (runtime: any, message: Memory, state?: any) => Promise<boolean>;
  handler: (runtime: any, message: Memory, state?: any, options?: any, callback?: Callback, responses?: Memory[]) => Promise<ActionResult | void | undefined>;
}
export interface ElizaPlugin { name: string; description: string; actions?: ElizaAction[] }

// Base58 run of mint length; the message text is where Eliza puts what the user or the model wrote.
const MINT_IN_TEXT = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
export const mintsIn = (text: string | undefined) => [...new Set(text?.match(MINT_IN_TEXT) ?? [])];

const result = (d: Decision): ActionResult => ({
  success: true,
  text: describe(d),
  values: { sentinelAction: d.action, sentinelVerdict: d.verdict, sentinelRisk: d.riskScore },
  data: { decision: d },
});

export function checkTokenAction(guard: Guard, opts: CheckOptions = {}): ElizaAction {
  return {
    name: 'CHECK_TOKEN_RISK',
    similes: ['RUG_CHECK', 'IS_IT_A_RUG', 'TOKEN_SAFETY', 'SENTINEL_CHECK'],
    description: 'Check whether a Solana token is a rug before buying it. Asks Sentinel, an accountable oracle with a Verified by Concordium badge, and returns allow, warn or block with the reason and an on-chain audit link.',
    validate: async (_rt, message) => mintsIn(message.content.text).length > 0,
    handler: async (_rt, message, _state, options, callback) => {
      const mint = (options as { mint?: string } | undefined)?.mint ?? mintsIn(message.content.text)[0];
      if (!mint) return { success: false, error: 'no Solana mint in the message' };
      const d = await guard.check(mint, opts);
      await callback?.({ text: describe(d), actions: ['CHECK_TOKEN_RISK'], sentinel: d });
      return result(d);
    },
    examples: [[
      { name: '{{user1}}', content: { text: 'is DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 safe to buy?' } },
      { name: '{{agent}}', content: { text: 'WARN DezXAZ… free screen is clean; run a full check before size', actions: ['CHECK_TOKEN_RISK'] } },
    ]],
  };
}

/**
 * Put the guard in front of an existing action, e.g. the Solana plugin's swap.
 * `mintOf` finds the token being bought (defaults to the options' outputMint / mint, then the last mint in the text).
 * A block stops the action and tells the user why; a warn runs it only if `onWarn` says so (default: stop).
 */
export function guardAction(action: ElizaAction, guard: Guard, o: CheckOptions & {
  mintOf?: (message: Memory, options: any) => string | undefined;
  onWarn?: (d: Decision) => boolean | Promise<boolean>;
} = {}): ElizaAction {
  const mintOf = o.mintOf ?? ((m: Memory, opt: any) => opt?.outputMint ?? opt?.mint ?? opt?.tokenAddress ?? mintsIn(m.content.text).at(-1));
  return {
    ...action,
    description: `${action.description} Guarded by Sentinel: tokens Sentinel blocks are never bought.`,
    handler: async (rt, message, state, options, callback, responses) => {
      const mint = mintOf(message, options);
      if (!mint) {
        await callback?.({ text: 'Sentinel Guard: no token mint found for this trade, not executing.' });
        return { success: false, error: 'no mint to check' };
      }
      const d = await guard.check(mint, o);
      const go = d.action === 'allow' || (d.action === 'warn' && (o.onWarn ? await o.onWarn(d) : false));
      if (!go) {
        await callback?.({ text: `Not buying. ${describe(d)}`, sentinel: d });
        return { ...result(d), success: false, error: `blocked by Sentinel Guard: ${d.reason}` };
      }
      return action.handler(rt, message, state, options, callback, responses);
    },
  };
}

export function sentinelGuardPlugin(guard: Guard, opts: CheckOptions = {}): ElizaPlugin {
  return {
    name: 'sentinel-guard',
    description: 'Pre-trade rug check for Solana tokens by Sentinel, an accountable oracle registered in the Concordium Agent Registry. Paid per verdict over x402.',
    actions: [checkTokenAction(guard, opts)],
  };
}
