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
      page: stack(['header', 'avail_group', 'btn_lock']),
      header: item("you're in.", 'when do you go quiet? this is your 8-hour safe window (UTC).'),
      avail_group: {
        type: 'toggle_group',
        props: {
          name: 'window',
          options: ['midnight–8am', '8am–4pm', '4pm–midnight', 'custom hour'],
          orientation: 'vertical',
        },
      },
      btn_lock: submitBtn('lock it in', `${base}/?a=set_avail`, { variant: 'primary' }),
    },
  });
}

function customAvailPage(base: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'hour_slider', 'btn_confirm']),
      header: item('custom window', 'your 8-hour window starts at this UTC hour (0 = midnight UTC).'),
      hour_slider: {
        type: 'slider',
        props: { name: 'hour', min: 0, max: 23, step: 1, defaultValue: 0, label: 'window start (UTC hour)', showValue: true },
      },
      btn_confirm: submitBtn('confirm', `${base}/?a=set_custom_avail`, { variant: 'primary' }),
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

    const window = String(ctx.action.inputs['window'] ?? 'midnight–8am');
    if (window === 'custom hour') return customAvailPage(base) as never;

    const start = window === '8am–4pm' ? 8 : window === '4pm–midnight' ? 16 : 0;
    await db.setAvailability(fid, start);
    return confirmedPage(base, `${base}/player?fid=${fid}`) as never;
  }

  if (action === 'set_custom_avail') {
    const player = await db.getPlayer(fid);
    if (!player) return hookPage(base) as never;
    const hour = Math.max(0, Math.min(23, Math.floor(Number(ctx.action.inputs['hour'] ?? 0))));
    await db.setAvailability(fid, hour);
    return confirmedPage(base, `${base}/player?fid=${fid}`) as never;
  }

  return hookPage(base) as never;
};
