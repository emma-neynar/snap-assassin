import type { SnapFunction } from '@farcaster/snap';
import * as db from '../db.js';
import { getUsernameByFid } from '../neynar.js';
import {
  buildResponse, stack, item, text, badge, separator,
  submitBtn, composeCastBtn, snapBase,
} from '../snap-utils.js';
import type { Player } from '../types.js';

const HOST_FID = process.env.HOST_FID ? Number(process.env.HOST_FID) : null;

// ── Page builders ─────────────────────────────────────────────────────────────

function hookPage(base: string) {
  return buildResponse({
    elements: {
      page: stack(['title', 'subtitle', 'sep', 'btn_in', 'btn_no']),
      title: text('snap assassin', { weight: 'bold' }),
      subtitle: text("an async elimination game. hunt your target. don't get got.", { size: 'sm' }),
      sep: separator(),
      btn_in: submitBtn("i'm in", `${base}/?a=join`, { variant: 'primary' }),
      btn_no: submitBtn('no thanks', `${base}/?a=nope`),
    },
  });
}

function availabilityPage(base: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'grid', 'btn_lock']),
      header: item("pick your 8 quiet hours (UTC).", 'tap exactly 8 hours when you go dark — you\'re safe and unhuntable during these.'),
      grid: {
        type: 'cell_grid',
        props: {
          name: 'hours',
          cols: 6,
          rows: 4,
          gap: 'sm',
          rowHeight: 32,
          select: 'multiple',
          cells: Array.from({ length: 24 }, (_, i) => ({
            label: String(i).padStart(2, '0'),
          })),
        },
      },
      btn_lock: submitBtn('lock it in', `${base}/?a=set_avail`, { variant: 'primary' }),
    },
  });
}

function availabilityErrorPage(base: string, picked: number) {
  return buildResponse({
    elements: {
      page: stack(['header', 'hint', 'btn_back']),
      header: item(`you picked ${picked} hours.`, 'select exactly 8 — no more, no less.'),
      hint: text('tap the grid again and choose exactly 8 UTC hours to go quiet.', { size: 'sm' }),
      btn_back: submitBtn('try again', `${base}/?a=join`, { variant: 'primary' }),
    },
  });
}

function confirmedPage(base: string, playerUrl: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'post_hint', 'btn_share']),
      header: item('locked in.', 'waiting for the host to start the game.'),
      post_hint: text("post this snap to your farcaster profile — that's your body in the game.", { size: 'sm' }),
      btn_share: composeCastBtn('post to my profile', "i'm playing snap assassin 🎯", playerUrl),
    },
  });
}

async function waitingRoomPage(base: string, playerUrl: string, viewerFid: number) {
  const registeredCount = await db.getRegisteredCount();
  const isHost = HOST_FID !== null && viewerFid === HOST_FID;

  const children = ['header', 'stats', 'share_btn'];
  if (isHost) children.push('start_btn');
  else children.push('hint');

  return buildResponse({
    elements: {
      page: stack(children),
      header: item('waiting room', `${registeredCount} hunter${registeredCount !== 1 ? 's' : ''} signed up`),
      stats: badge(`${registeredCount} registered`, { color: 'blue' }),
      share_btn: composeCastBtn('recruit more players', 'come play snap assassin 🎯', playerUrl),
      ...(isHost
        ? { start_btn: submitBtn('start the game →', `${base}/?a=start_game`, { variant: 'primary' }) }
        : { hint: text('waiting for the host to start the game.', { size: 'sm' }) }),
    },
  });
}

function activeGamePage(base: string, player: Player, targetName: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'target_badge', 'hint']),
      header: item('your target:', 'find them on farcaster.'),
      target_badge: badge(`@${targetName}`, { color: 'red' }),
      hint: text('navigate to their profile and find the snap. the button only appears for you.', { size: 'sm' }),
    },
  });
}

function eliminatedPage(base: string, player: Player, eliminatorName: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'kills_badge', 'by_text', 'sep', 'spectate_btn']),
      header: item('eliminated. 💀', `${player.kill_count} kill${player.kill_count !== 1 ? 's' : ''} before you went down`),
      kills_badge: badge(`eliminated by @${eliminatorName}`, { color: 'gray' }),
      by_text: text('you can still watch the game play out.', { size: 'sm' }),
      sep: separator(),
      spectate_btn: submitBtn('spectate →', `${base}/?a=spectate`, { variant: 'primary' }),
    },
  });
}

async function spectatePage(base: string) {
  const alive = await db.getAlivePlayers();
  const recent = await db.getRecentEliminations(3);

  return buildResponse({
    elements: {
      page: stack(['header', 'alive_badge', 'sep', 'feed_header', 'btn_refresh']),
      header: item('spectating', 'watch the hunt unfold'),
      alive_badge: badge(
        `${alive.length} hunter${alive.length !== 1 ? 's' : ''} alive`,
        { color: alive.length <= 3 ? 'red' : 'blue' }
      ),
      sep: separator(),
      feed_header: text(
        recent.length > 0
          ? recent.map(e => `@${e.assassin_username} got @${e.target_username}`).join(' · ')
          : 'no eliminations yet.',
        { size: 'sm' }
      ),
      btn_refresh: submitBtn('refresh', `${base}/?a=spectate`),
    },
  });
}

function winnerPage(base: string, player: Player) {
  return buildResponse({
    effects: ['confetti'],
    accent: 'green',
    elements: {
      page: stack(['header', 'kills_badge', 'hint']),
      header: item('you won.', 'last one standing.'),
      kills_badge: badge(`${player.kill_count} kill${player.kill_count !== 1 ? 's' : ''}`, { color: 'green' }),
      hint: text('snap assassin.', { size: 'sm', align: 'center' }),
    },
  });
}

function nothanksPage() {
  return buildResponse({
    elements: {
      page: stack(['msg']),
      msg: item('maybe next time.', 'the game goes on without you.'),
    },
  });
}

function registrationClosedPage() {
  return buildResponse({
    elements: {
      page: stack(['header']),
      header: item('registration closed.', 'game is already underway.'),
    },
  });
}

// ── Main snap handler ─────────────────────────────────────────────────────────

export const mainSnap: SnapFunction = async (ctx) => {
  await db.initDb();

  const base = snapBase(ctx.request);
  const url = new URL(ctx.request.url);
  const action = url.searchParams.get('a') ?? '';

  if (ctx.action.type === 'get') return hookPage(base) as never;

  const fid = ctx.action.user.fid;
  const config = await db.getGameConfig();

  await db.processExpiredGracePeriods();
  await db.maybeStartGame();

  if (action === 'nope') return nothanksPage() as never;

  if (action === 'spectate') return (await spectatePage(base)) as never;

  if (action === 'start_game') {
    if (HOST_FID === null || fid !== HOST_FID) {
      return buildResponse({
        elements: { page: stack(['msg']), msg: item('not authorised.', 'only the host can start the game.') },
      }) as never;
    }
    if (config.game_state !== 'registration') {
      return buildResponse({
        elements: { page: stack(['msg']), msg: item('already started.', 'the game is underway.') },
      }) as never;
    }
    const count = await db.getRegisteredCount();
    if (count < 2) {
      return buildResponse({
        elements: { page: stack(['msg']), msg: item('not enough players.', `${count} registered — need at least 2.`) },
      }) as never;
    }
    await db.assignTargets();
    return buildResponse({
      effects: ['confetti'],
      elements: {
        page: stack(['header', 'count_badge']),
        header: item('game started.', 'targets assigned. the hunt is on.'),
        count_badge: badge(`${count} hunters in play`, { color: 'red' }),
      },
    }) as never;
  }

  if (action === 'join' || action === 'go') {
    const player = await db.getPlayer(fid);

    if (!player) {
      if (config.game_state !== 'registration') return registrationClosedPage() as never;
      const username = await getUsernameByFid(fid);
      await db.registerPlayer(fid, username);
      return availabilityPage(base) as never;
    }

    if (player.status === 'registered') return availabilityPage(base) as never;

    if (player.status === 'waiting') {
      const fresh = await db.getGameConfig();
      if (fresh.game_state === 'active') {
        await db.touchPlayer(fid);
        const refreshed = await db.getPlayer(fid);
        const target = refreshed?.target_fid ? await db.getPlayer(refreshed.target_fid) : null;
        const targetName = target?.username ?? `fid:${refreshed?.target_fid}`;
        return activeGamePage(base, refreshed!, targetName) as never;
      }
      return (await waitingRoomPage(base, `${base}/player?fid=${fid}`, fid)) as never;
    }

    if (player.status === 'alive') {
      await db.touchPlayer(fid);
      const refreshed = await db.getPlayer(fid);
      const target = refreshed?.target_fid ? await db.getPlayer(refreshed.target_fid) : null;
      const targetName = target?.username ?? `fid:${refreshed?.target_fid}`;
      return activeGamePage(base, refreshed!, targetName) as never;
    }

    if (player.status === 'eliminated') {
      const eliminator = player.eliminated_by_fid
        ? await getUsernameByFid(player.eliminated_by_fid)
        : 'unknown';
      return eliminatedPage(base, player, eliminator) as never;
    }

    if (player.status === 'winner') return winnerPage(base, player) as never;

    if (config.game_state !== 'registration') return registrationClosedPage() as never;
    const username = await getUsernameByFid(fid);
    await db.registerPlayer(fid, username);
    return availabilityPage(base) as never;
  }

  if (action === 'set_avail') {
    const player = await db.getPlayer(fid);
    if (!player) return hookPage(base) as never;

    const raw = ctx.action.inputs['hours'];
    const selected = (Array.isArray(raw) ? raw : []).map(Number).filter(h => h >= 0 && h <= 23);

    if (selected.length !== 8) {
      return availabilityErrorPage(base, selected.length) as never;
    }

    // Store selected quiet hours as a 24-bit bitmask in availability_start
    const awayMask = selected.reduce((mask, h) => mask | (1 << h), 0);
    await db.setAvailability(fid, awayMask);
    return confirmedPage(base, `${base}/player?fid=${fid}`) as never;
  }

  return hookPage(base) as never;
};
