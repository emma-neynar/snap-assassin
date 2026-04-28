import type { SnapFunction } from '@farcaster/snap';
import * as db from '../db.js';
import { getUsernameByFid } from '../neynar.js';
import {
  buildResponse, stack, item, text, badge, separator,
  submitBtn, composeCastBtn, snapBase,
} from '../snap-utils.js';
import type { Player } from '../types.js';

// ── Profile page builders ─────────────────────────────────────────────────────

function publicAliveView(target: Player, base: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'sep', 'approach_btn']),
      header: item(`@${target.username}`, 'still standing.'),
      sep: separator(),
      approach_btn: submitBtn('approach', `${base}/player?fid=${target.fid}&a=approach`),
    },
  });
}

function publicEliminatedView(target: Player) {
  return buildResponse({
    elements: {
      page: stack(['header', 'kills_badge']),
      header: item(`@${target.username}`, 'eliminated. 💀'),
      kills_badge: badge(`${target.kill_count} kill${target.kill_count !== 1 ? 's' : ''}`, { color: 'gray' }),
    },
  });
}

function publicWinnerView(target: Player) {
  return buildResponse({
    effects: ['confetti'],
    accent: 'green',
    elements: {
      page: stack(['header', 'kills_badge']),
      header: item(`@${target.username}`, 'winner. 🏆 last one standing.'),
      kills_badge: badge(`${target.kill_count} kills`, { color: 'green' }),
    },
  });
}

function assassinReadyView(target: Player, base: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'shot_btn']),
      header: item('your target is here.', `@${target.username} — now or never.`),
      shot_btn: submitBtn('take the shot 🎯', `${base}/player?fid=${target.fid}&a=shoot`, { variant: 'primary' }),
    },
  });
}

function missView() {
  return buildResponse({
    elements: {
      page: stack(['header']),
      header: item('missed.', "they're in their quiet hours. try later."),
    },
  });
}

function eliminatedByYouView(killedName: string, newTargetName: string | null, base: string, playerUrl: string) {
  const children = newTargetName
    ? ['header', 'cast_btn', 'sep', 'new_target_label', 'new_target_badge']
    : ['header', 'cast_btn'];
  return buildResponse({
    elements: {
      page: stack(children),
      header: item(`@${killedName} is out. 💀`, newTargetName ? 'announce it. your next target:' : 'announce it. you might be the last one standing.'),
      cast_btn: composeCastBtn('announce the kill 🎯', `just eliminated @${killedName} in caster assassin 💀`, playerUrl),
      ...(newTargetName ? {
        sep: separator(),
        new_target_label: text('your new target:', { size: 'sm' }),
        new_target_badge: badge(`@${newTargetName}`, { color: 'red' }),
      } : {}),
    },
  });
}

function gameNotActiveView() {
  return buildResponse({
    elements: {
      page: stack(['header']),
      header: item('game not active.', 'check back when the hunt begins.'),
    },
  });
}

function errView(msg: string) {
  return buildResponse({
    elements: { page: stack(['msg']), msg: item(msg, '') },
  });
}

// ── Player snap handler ───────────────────────────────────────────────────────

export const playerSnap: SnapFunction = async (ctx) => {
  await db.initDb();

  const base = snapBase(ctx.request);
  const url = new URL(ctx.request.url);
  const targetFidParam = url.searchParams.get('fid');
  const action = url.searchParams.get('a') ?? '';

  if (!targetFidParam) return errView('invalid link.') as never;

  const targetFid = Number(targetFidParam);
  const target = await db.getPlayer(targetFid);

  if (!target) return errView('player not found.') as never;

  // ── Public GET ────────────────────────────────────────────────────────────

  if (ctx.action.type === 'get') {
    if (target.status === 'winner') return publicWinnerView(target) as never;
    if (target.status === 'eliminated') return publicEliminatedView(target) as never;
    return publicAliveView(target, base) as never;
  }

  // ── Authenticated POST ────────────────────────────────────────────────────

  const viewerFid = ctx.action.user.fid;
  await db.touchPlayer(viewerFid);

  if (target.status === 'winner') return publicWinnerView(target) as never;
  if (target.status === 'eliminated') return publicEliminatedView(target) as never;

  const config = await db.getGameConfig();

  // ── take the shot ─────────────────────────────────────────────────────────

  if (action === 'shoot') {
    if (config.game_state !== 'active') return gameNotActiveView() as never;

    const [freshTarget, freshViewer] = await Promise.all([
      db.getPlayer(targetFid),
      db.getPlayer(viewerFid),
    ]);

    if (!freshViewer || freshViewer.status !== 'alive')
      return errView("you're out. eliminated players can't shoot.") as never;

    if (freshViewer.target_fid !== targetFid)
      return errView("wrong target. this isn't your assigned target.") as never;

    if (!freshTarget || freshTarget.status !== 'alive')
      return errView('already gone.') as never;

    // Bitmask check: availability_start stores the 24 away hours as bit flags
    const utcHour = new Date().getUTCHours();
    const isAway = Boolean((freshTarget.availability_start >> utcHour) & 1);
    if (isAway) return missView() as never;

    const killedName = freshTarget.username;
    await db.processElimination(targetFid, viewerFid);

    const updatedViewer = await db.getPlayer(viewerFid);
    const newTarget = updatedViewer?.target_fid ? await db.getPlayer(updatedViewer.target_fid) : null;
    const newTargetName = newTarget?.username ?? null;

    return eliminatedByYouView(killedName, newTargetName, base, `${base}/player?fid=${viewerFid}`) as never;
  }

  // ── approach / identify ───────────────────────────────────────────────────

  const fresh = await db.getPlayer(targetFid);
  if (!fresh) return errView('player not found.') as never;

  // Target viewing their own snap
  if (viewerFid === targetFid) {
    return buildResponse({
      elements: {
        page: stack(['header']),
        header: item(`@${fresh.username}`, "you're alive. keep your head down."),
      },
    }) as never;
  }

  // Assigned assassin
  if (fresh.assassin_fid === viewerFid) {
    const viewer = await db.getPlayer(viewerFid);
    if (!viewer || viewer.status !== 'alive') return errView("you're out.") as never;
    if (config.game_state !== 'active') return gameNotActiveView() as never;
    return assassinReadyView(fresh, base) as never;
  }

  // Everyone else
  return publicAliveView(fresh, base) as never;
};
