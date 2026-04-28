import type { SnapFunction } from '@farcaster/snap';
import * as db from '../db.js';
import { getUsernameByFid } from '../neynar.js';
import {
  buildResponse, stack, item, text, badge, separator,
  submitBtn, composeCastBtn, snapBase,
} from '../snap-utils.js';
import type { Player } from '../types.js';

const HOST_FID = process.env.HOST_FID ? Number(process.env.HOST_FID) : null;

const ALLOWED_FIDS: Set<number> | null = process.env.ALLOWED_FIDS
  ? new Set(process.env.ALLOWED_FIDS.split(',').map(s => Number(s.trim())).filter(Boolean))
  : null;

function isAllowed(fid: number): boolean {
  return ALLOWED_FIDS === null || ALLOWED_FIDS.has(fid);
}

// ── Page builders ─────────────────────────────────────────────────────────────

function testingSplashPage(base: string) {
  return buildResponse({
    elements: {
      page: stack(['title', 'subtitle', 'btn']),
      title: text('BERT IS TESTING HIS SNAP', { weight: 'bold', align: 'center' }),
      subtitle: text('private beta. tap to see if you made the list.', { size: 'sm', align: 'center' }),
      btn: submitBtn("am i in? →", `${base}/?a=go`, { variant: 'primary' }),
    },
  });
}

function notAllowedPage() {
  return buildResponse({
    elements: {
      page: stack(['msg']),
      msg: item('not on the list.', 'this beta is invite-only.'),
    },
  });
}

function hookPage(base: string) {
  return buildResponse({
    elements: {
      page: stack(['title', 'subtitle', 'sep', 'btn_in']),
      title: text('caster assassin', { weight: 'bold' }),
      subtitle: text('do you want to play a game?', { size: 'sm' }),
      sep: separator(),
      btn_in: submitBtn("i'm in →", `${base}/?a=explain`, { variant: 'primary' }),
    },
  });
}

function explainerPage(base: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'rule1', 'rule2', 'rule3', 'rule4', 'sep', 'btn_join']),
      header: item('here\'s how it works.', 'an async elimination game on farcaster.'),
      rule1: text('🎯  you get a target. hunt them down by visiting their profile snap.', { size: 'sm' }),
      rule2: text('⏰  pick 8 quiet hours (UTC) when you go dark — you\'re unhuntable then.', { size: 'sm' }),
      rule3: text('🛡️  if someone shoots you, you have 5 minutes to call safe. miss it and you\'re out.', { size: 'sm' }),
      rule4: text('💀  last one standing wins.', { size: 'sm' }),
      sep: separator(),
      btn_join: submitBtn('let\'s go →', `${base}/?a=join`, { variant: 'primary' }),
    },
  });
}

function availabilityPage(base: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'grid', 'btn_lock']),
      header: item('pick your 8 quiet hours (UTC).', 'you\'re safe — and unhuntable — during these.'),
      grid: {
        type: 'cell_grid',
        props: {
          name: 'hours',
          cols: 6,
          rows: 4,
          gap: 'sm',
          rowHeight: 36,
          select: 'multiple',
          cells: Array.from({ length: 24 }, (_, i) => ({
            row: Math.floor(i / 6),
            col: i % 6,
            content: String(i).padStart(2, '0'),
          })),
        },
      },
      btn_lock: submitBtn('lock it in →', `${base}/?a=set_avail`, { variant: 'primary' }),
    },
  });
}

function availabilityErrorPage(base: string, picked: number) {
  return buildResponse({
    elements: {
      page: stack(['header', 'hint', 'btn_back']),
      header: item(`you picked ${picked} hours.`, 'needs to be exactly 8. no more, no less.'),
      hint: text('go back and tap exactly 8 UTC hours to go quiet.', { size: 'sm' }),
      btn_back: submitBtn('try again', `${base}/?a=join`, { variant: 'primary' }),
    },
  });
}

function confirmedPage(base: string, playerUrl: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'post_hint', 'btn_share']),
      header: item('you\'re in.', 'waiting for the host to start the hunt.'),
      post_hint: text("post this snap to your farcaster profile — that's your body in the game.", { size: 'sm' }),
      btn_share: composeCastBtn('post to my profile', "i'm playing caster assassin 🎯", playerUrl),
    },
  });
}

async function waitingRoomPage(base: string, playerUrl: string, viewerFid: number) {
  const registeredCount = await db.getRegisteredCount();
  const isHost = HOST_FID !== null && viewerFid === HOST_FID;

  const children = ['header', 'stats', 'share_btn'];
  if (isHost) children.push('start_btn', 'reset_btn');
  else children.push('hint');

  return buildResponse({
    elements: {
      page: stack(children),
      header: item('waiting room.', `${registeredCount} hunter${registeredCount !== 1 ? 's' : ''} signed up`),
      stats: badge(`${registeredCount} registered`, { color: 'blue' }),
      share_btn: composeCastBtn('recruit more hunters', 'come play caster assassin 🎯', playerUrl),
      ...(isHost
        ? {
            start_btn: submitBtn('start the hunt →', `${base}/?a=start_game`, { variant: 'primary' }),
            reset_btn: submitBtn('reset game', `${base}/?a=reset_game`),
          }
        : { hint: text('sit tight. the host pulls the trigger.', { size: 'sm' }) }),
    },
  });
}

function activeGamePage(base: string, player: Player, targetName: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'target_badge', 'hint']),
      header: item('your target:', 'find them on farcaster.'),
      target_badge: badge(`@${targetName}`, { color: 'red' }),
      hint: text('go to their profile and find the snap. the button only shows for you.', { size: 'sm' }),
    },
  });
}

function eliminatedPage(base: string, player: Player, eliminatorName: string) {
  return buildResponse({
    elements: {
      page: stack(['header', 'kills_badge', 'by_text', 'sep', 'spectate_btn']),
      header: item('eliminated. 💀', `${player.kill_count} kill${player.kill_count !== 1 ? 's' : ''} before you went down`),
      kills_badge: badge(`got by @${eliminatorName}`, { color: 'gray' }),
      by_text: text('you can still watch the carnage unfold.', { size: 'sm' }),
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
      header: item('spectating.', 'watch the hunt unfold'),
      alive_badge: badge(
        `${alive.length} hunter${alive.length !== 1 ? 's' : ''} still standing`,
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
      hint: text('caster assassin.', { size: 'sm', align: 'center' }),
    },
  });
}

function nothanksPage() {
  return buildResponse({
    elements: {
      page: stack(['msg']),
      msg: item('your loss.', 'the game goes on without you.'),
    },
  });
}

function registrationClosedPage() {
  return buildResponse({
    elements: {
      page: stack(['header']),
      header: item('too late.', 'the hunt is already underway.'),
    },
  });
}

// ── Main snap handler ─────────────────────────────────────────────────────────

export const mainSnap: SnapFunction = async (ctx) => {
  await db.initDb();

  const base = snapBase(ctx.request);
  const url = new URL(ctx.request.url);
  const action = url.searchParams.get('a') ?? '';

  if (ctx.action.type === 'get') return testingSplashPage(base) as never;

  const fid = ctx.action.user.fid;

  if (!isAllowed(fid)) return notAllowedPage() as never;

  const config = await db.getGameConfig();

  await db.maybeStartGame();

  if (action === 'nope') return nothanksPage() as never;

  if (action === 'go') return explainerPage(base) as never;

  if (action === 'explain') return explainerPage(base) as never;

  if (action === 'spectate') return (await spectatePage(base)) as never;

  if (action === 'start_game') {
    if (HOST_FID === null || fid !== HOST_FID) {
      return buildResponse({
        elements: { page: stack(['msg']), msg: item('nice try.', 'only the host can start the game.') },
      }) as never;
    }
    if (config.game_state !== 'registration') {
      return buildResponse({
        elements: { page: stack(['msg']), msg: item('already running.', 'the hunt is underway.') },
      }) as never;
    }
    const count = await db.getRegisteredCount();
    if (count < 2) {
      return buildResponse({
        elements: { page: stack(['msg']), msg: item('not enough hunters.', `${count} registered — need at least 2.`) },
      }) as never;
    }
    await db.assignTargets();
    return buildResponse({
      effects: ['confetti'],
      elements: {
        page: stack(['header', 'count_badge']),
        header: item('the hunt is on.', 'targets assigned. good luck.'),
        count_badge: badge(`${count} hunters in play`, { color: 'red' }),
      },
    }) as never;
  }

  if (action === 'reset_game') {
    if (HOST_FID === null || fid !== HOST_FID) {
      return buildResponse({
        elements: { page: stack(['msg']), msg: item('nice try.', 'only the host can reset.') },
      }) as never;
    }
    await db.resetGame();
    return buildResponse({
      elements: {
        page: stack(['header', 'hint']),
        header: item('reset.', 'all players cleared. back to registration.'),
        hint: text('testers can rejoin from scratch now.', { size: 'sm' }),
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
    // cell_grid submits "row,col|row,col|..." — convert back to hour (row*6+col) for a 6-col grid
    const rawStr = typeof raw === 'string' ? raw : '';
    const selected = rawStr.length === 0 ? [] : rawStr.split('|')
      .filter(p => p.includes(','))
      .map(p => { const [r, c] = p.split(',').map(Number); return r * 6 + c; })
      .filter(h => h >= 0 && h <= 23);

    if (selected.length !== 8) {
      return availabilityErrorPage(base, selected.length) as never;
    }

    // Store selected quiet hours as a 24-bit bitmask in availability_start
    const awayMask = selected.reduce((mask, h) => mask | (1 << h), 0);
    await db.setAvailability(fid, awayMask);
    return confirmedPage(base, `${base}/player?fid=${fid}`) as never;
  }

  if (HOST_FID !== null && fid === HOST_FID) {
    const registeredCount = await db.getRegisteredCount();
    return buildResponse({
      elements: {
        page: stack(['header', 'stats', 'reset_btn', 'start_btn']),
        header: item('host panel.', 'you\'re the host.'),
        stats: badge(`${registeredCount} registered`, { color: 'blue' }),
        reset_btn: submitBtn('reset game', `${base}/?a=reset_game`),
        start_btn: submitBtn('start the hunt →', `${base}/?a=start_game`, { variant: 'primary' }),
      },
    }) as never;
  }

  return hookPage(base) as never;
};
