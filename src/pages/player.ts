import type { SnapFunction } from '@farcaster/snap';
import * as db from '../db.js';
import { notifyFid, getUsernameByFid } from '../neynar.js';
import {
  buildResponse, stack, item, text, badge, separator,
  submitBtn, fmtCountdown, snapBase,
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

function publicGraceView(target: Player, base: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'warn_badge', 'approach_btn']),
      header: item(`@${target.username}`, 'still standing.'),
      warn_badge: badge('incoming...', { color: 'amber' }),
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
      shot_btn: submitBtn('take the shot', `${base}/player?fid=${target.fid}&a=shoot`, { variant: 'primary' }),
    },
  });
}

function assassinWaitingView(target: Player) {
  return buildResponse({
    elements: {
      page: stack(['header', 'status_badge']),
      header: item('waiting...', `shot fired. @${target.username} has time to respond.`),
      status_badge: badge(
        target.grace_period_expires
          ? `${fmtCountdown(target.grace_period_expires)} remaining`
          : 'grace period active',
        { color: 'amber' }
      ),
    },
  });
}

function targetSelfGraceView(target: Player, base: string) {
  const timeLeft = target.grace_period_expires
    ? fmtCountdown(target.grace_period_expires)
    : '< 5min';
  return buildResponse({
    elements: {
      page: stack(['header', 'countdown_badge', 'sep', 'safe_btn']),
      header: item('incoming.', "call safe or you're out."),
      countdown_badge: badge(`${timeLeft} remaining`, { color: 'red' }),
      sep: separator(),
      safe_btn: submitBtn('call safe', `${base}/player?fid=${target.fid}&a=safe`, { variant: 'primary' }),
    },
  });
}

function targetSelfSafeView(target: Player) {
  return buildResponse({
    elements: {
      page: stack(['header', 'status']),
      header: item(`@${target.username}`, "you're safe — for now."),
      status: text('your assassin will try again.', { size: 'sm' }),
    },
  });
}

function missView() {
  return buildResponse({
    elements: {
      page: stack(['header']),
      header: item('missed.', "they weren't around."),
    },
  });
}

function shotFiredView(targetName: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'hint']),
      header: item('shot fired.', `@${targetName} has 5 minutes to call safe.`),
      hint: text('check back soon to see if they made it.', { size: 'sm' }),
    },
  });
}

function eliminatedByYouView(newTargetName: string | null, base: string) {
  const children = newTargetName
    ? ['header', 'new_target', 'sep', 'btn_refresh']
    : ['header', 'btn_refresh'];
  return buildResponse({
    elements: {
      page: stack(children),
      header: item('eliminated.', newTargetName ? 'your new target:' : 'game over.'),
      ...(newTargetName ? { new_target: badge(`@${newTargetName}`, { color: 'red' }), sep: separator() } : {}),
      btn_refresh: submitBtn('check game →', `${base}/?a=join`),
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

  await db.processExpiredGracePeriods();

  // ── Public GET ────────────────────────────────────────────────────────────

  if (ctx.action.type === 'get') {
    if (target.status === 'winner') return publicWinnerView(target) as never;
    if (target.status === 'eliminated') return publicEliminatedView(target) as never;
    if (target.grace_period_active) return publicGraceView(target, base) as never;
    return publicAliveView(target, base) as never;
  }

  // ── Authenticated POST ────────────────────────────────────────────────────

  const viewerFid = ctx.action.user.fid;
  await db.touchPlayer(viewerFid);

  if (target.status === 'winner') return publicWinnerView(target) as never;
  if (target.status === 'eliminated') return publicEliminatedView(target) as never;

  const config = await db.getGameConfig();

  // ── call safe ─────────────────────────────────────────────────────────────

  if (action === 'safe') {
    if (viewerFid !== targetFid) return errView('not your call.') as never;

    const fresh = await db.getPlayer(targetFid);
    if (!fresh?.grace_period_active) return targetSelfSafeView(fresh ?? target) as never;

    if (fresh.grace_period_expires && Date.now() > fresh.grace_period_expires) {
      await db.processElimination(targetFid, fresh.assassin_fid!);
      return publicEliminatedView((await db.getPlayer(targetFid)) ?? fresh) as never;
    }

    await db.clearGracePeriod(targetFid);
    if (fresh.assassin_fid) {
      await notifyFid(fresh.assassin_fid, 'Snap Assassin', `@${fresh.username} called safe. try again later.`);
    }
    return targetSelfSafeView(fresh) as never;
  }

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

    if (freshTarget.grace_period_active) return assassinWaitingView(freshTarget) as never;

    // Bitmask check: availability_start stores the 24 away hours as bit flags
    const utcHour = new Date().getUTCHours();
    const isAway = Boolean((freshTarget.availability_start >> utcHour) & 1);
    if (isAway) return missView() as never;

    await db.startGracePeriod(targetFid);
    await notifyFid(
      targetFid,
      'Snap Assassin 🎯',
      `incoming. you have 5 minutes to call safe. go to your profile snap now.`
    );

    return shotFiredView(freshTarget.username) as never;
  }

  // ── approach / identify ───────────────────────────────────────────────────

  const fresh = await db.getPlayer(targetFid);
  if (!fresh) return errView('player not found.') as never;

  // Target viewing their own snap
  if (viewerFid === targetFid) {
    if (fresh.grace_period_active) return targetSelfGraceView(fresh, base) as never;
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
    if (fresh.grace_period_active) return assassinWaitingView(fresh) as never;
    if (config.game_state !== 'active') return gameNotActiveView() as never;
    return assassinReadyView(fresh, base) as never;
  }

  // Everyone else
  if (fresh.grace_period_active) return publicGraceView(fresh, base) as never;
  return publicAliveView(fresh, base) as never;
};
