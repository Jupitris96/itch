
import {EventEmitter} from 'events'
import invariant from 'invariant'
import humanize from 'humanize-plus'

import {takeLatest} from 'redux-saga'
import {fork, take, put, call, select} from 'redux-saga/effects'

import {getUserMarket, getGlobalMarket} from './market'
import {delay} from './effects'

import {checkForGameUpdates, statusMessage} from '../actions'

import fetch from '../util/fetch'
import pathmaker from '../util/pathmaker'

import mklog from '../util/log'
const log = mklog('updater')
import {opts} from '../logger'

import {startDownload} from './tasks/start-download'
import {findWhere} from 'underline'

import {
  SESSION_READY,
  CHECK_FOR_GAME_UPDATE, CHECK_FOR_GAME_UPDATES
} from '../constants/action-types'

const DELAY_BETWEEN_GAMES = 25

// 30 minutes * 60 = seconds, * 1000 = millis
const DELAY_BETWEEN_PASSES = 30 * 60 * 1000

import findUpload from '../tasks/find-upload'
import findUpgradePath from '../tasks/find-upgrade-path'

function * _checkForGameUpdates () {
  // may be interrupted by a saga cancellation
  const caves = getGlobalMarket().getEntities('caves')
  invariant(caves, 'has caves')

  for (const caveId of Object.keys(caves)) {
    try {
      yield call(checkForGameUpdate, caves[caveId])
    } catch (e) {
      log(opts, `While checking for cave ${caveId} update: ${e.stack || e}`)
    }
    yield call(delay, DELAY_BETWEEN_GAMES)
  }
}

function * _checkForGameUpdate (action) {
  const {caveId, noisy = false} = action.payload
  invariant(typeof caveId === 'string', 'caveId is a string')

  const cave = getGlobalMarket().getEntity('caves', caveId)
  if (!cave) {
    log(opts, `No cave with id ${caveId}, bailing out`)
    return
  }

  try {
    const result = yield call(checkForGameUpdate, cave, {noisy})
    if (result && noisy) {
      if (result.err) {
        yield put(statusMessage(['status.game_update.check_failed', {err: result.err}]))
      }
    }
  } catch (e) {
    log(opts, `While checking for cave ${caveId} update: ${e.stack || e}`)
    if (noisy) {
      yield put(statusMessage(['status.game_update.check_failed', {err: e}]))
    }
  }
}

function * checkForGameUpdate (cave, taskOpts = {}) {
  const {noisy = false} = taskOpts

  if (!cave.launchable) {
    log(opts, `Cave isn't launchable, skipping: ${cave.id}`)
    return {}
  }

  if (!cave.gameId) {
    log(opts, `Cave lacks gameId, skipping: ${cave.id}`)
    return {err: 'Internal error'}
  }

  const credentials = yield select((state) => state.session.credentials)
  invariant(credentials, 'has credentials')

  const market = getUserMarket()
  const globalMarket = getGlobalMarket()
  let game
  try {
    game = yield call(fetch.gameLazily, market, credentials, cave.gameId)
  } catch (e) {
    log(opts, `Could not fetch game for ${cave.gameId}, skipping (${e.message || e})`)
    return {err: e}
  }

  const logger = new mklog.Logger({sinks: {console: false, string: true}})

  if (game) {
    log(opts, `Looking for updates to ${game.title}...`)
    const out = new EventEmitter()
    const findKey = () => market.getEntities('downloadKeys')::findWhere({gameId: game.id})
    const taskOpts = {
      ...opts,
      logger,
      game,
      gameId: game.id,
      credentials,
      downloadKey: cave.downloadKey || findKey(),
      market
    }

    try {
      const {uploads, downloadKey} = yield call(findUpload, out, taskOpts)
      if (uploads.length === 0) {
        log(opts, `Can't check for updates for ${game.title}, no uploads.`)
        logger.contents.split('\n').map((line) => log(opts, `> ${line}`))
        return {err: 'No uploads found'}
      }

      let hasUpgrade = false

      if (cave.uploadId && cave.buildId) {
        log(opts, `Looking for new builds of ${game.title}, from build ${cave.buildId}`)
        const upload = uploads::findWhere({id: cave.uploadId})
        if (!upload || !upload.buildId) {
          log(opts, 'Uh oh, our wharf-enabled upload disappeared')
        } else {
          if (upload.buildId !== cave.buildId) {
            log(opts, `Got new build available: ${upload.buildId} > ${cave.buildId}`)
            if (noisy) {
              yield put(statusMessage(['status.game_update.found', {title: game.title}]))
            }

            hasUpgrade = true

            const upgradeOpts = {
              ...taskOpts,
              upload,
              gameId: game.id,
              currentBuildId: cave.buildId
            }
            try {
              const {upgradePath, totalSize} = yield call(findUpgradePath, out, upgradeOpts)
              log(opts, `Got ${upgradePath.length} patches to download, ${humanize.fileSize(totalSize)} total`)
              const archivePath = pathmaker.downloadPath(upload)

              yield call(startDownload, {
                game,
                gameId: game.id,
                upload,
                destPath: archivePath,
                downloadKey,
                reason: 'update',
                incremental: true,
                globalMarket,
                upgradePath,
                totalSize,
                cave
              })
              return {hasUpgrade}
            } catch (e) {
              log(opts, `While getting upgrade path: ${e.message || e}`)
              return {err: e.message}
            }
          }
        }
      }

      const upload = uploads[0]
      const differentUpload = upload.id !== cave.uploadId
      const wentWharf = upload.buildId && !cave.buildId

      if (hasUpgrade || differentUpload || wentWharf) {
        log(opts, `Got a new upload for ${game.title}: ${upload.filename}`)
        if (hasUpgrade) {
          log(opts, '(Reason: forced)')
        }
        if (differentUpload) {
          log(opts, '(Reason: different upload)')
        }
        if (wentWharf) {
          log(opts, '(Reason: went wharf)')
        }

        const archivePath = pathmaker.downloadPath(upload)

        if (noisy) {
          yield put(statusMessage(['status.game_update.found', {title: game.title}]))
        }

        yield call(startDownload, {
          game,
          gameId: game.id,
          upload,
          totalSize: upload.size,
          destPath: archivePath,
          downloadKey,
          reason: 'update'
        })
        return {hasUpgrade}
      }
    } catch (e) {
      log(opts, `While looking for update: ${e.stack || e}`)
      return {err: e}
    }
  } else {
    log(opts, `Can't check for updates for ${game.title}, not visible by current user?`)
  }

  if (noisy) {
    yield put(statusMessage(['status.game_update.not_found', {title: game.title}]))
  }
  return {}
}

function * installUpdater () {
  yield take(SESSION_READY)

  while (true) {
    log(opts, 'Regularly scheduled check for game updates...')
    yield put(checkForGameUpdates())
    yield call(delay, DELAY_BETWEEN_PASSES)
  }
}

export default function * updater () {
  yield [
    fork(installUpdater),
    takeLatest(CHECK_FOR_GAME_UPDATES, _checkForGameUpdates),
    takeLatest(CHECK_FOR_GAME_UPDATE, _checkForGameUpdate)
  ]
}
