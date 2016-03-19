
import createQueue from './queue'
import {app} from '../electron'
import os from '../util/os'

import env from '../env'
import urls from '../constants/urls'

import {takeEvery} from 'redux-saga'
import {call} from 'redux-saga/effects'

import mklog from '../util/log'
const log = mklog('self-update')
import {opts} from '../logger'

import {BOOT, CHECK_FOR_SELF_UPDATE, APPLY_SELF_UPDATE} from '../constants/action-types'

import {
  checkForSelfUpdate,
  selfUpdateError,
  checkingForSelfUpdate,
  selfUpdateAvailable,
  selfUpdateNotAvailable,
  selfUpdateDownloaded
} from '../actions'

let autoUpdater

// 6 hours, * 60 = minutes, * 60 = seconds, * 1000 = millis
const UPDATE_INTERVAL = 6 * 60 * 60 * 1000

export function * _boot () {
  const queue = createQueue('self-update')

  try {
    autoUpdater = require('electron').autoUpdater
    autoUpdater.on('error', (ev, err) => queue.dispatch(selfUpdateError(err)))
    log(opts, 'Self-updater installed!')
  } catch (e) {
    log(opts, `While installing self-updater: ${e.message}`)
    autoUpdater = null
    return
  }

  const base = urls.updateServers[env.channel]
  const platform = os.platform() + '_' + os.arch()
  const version = app.getVersion()
  const feedUrl = `${base}/update/${platform}/${version}`
  log(opts, `update feed: ${feedUrl}`)
  autoUpdater.setFeedURL(feedUrl)

  autoUpdater.on('checking-for-update', () => queue.dispatch(checkingForSelfUpdate()))
  autoUpdater.on('update-available', () => queue.dispatch(selfUpdateAvailable()))
  autoUpdater.on('update-not-available', () => queue.dispatch(selfUpdateNotAvailable()))
  autoUpdater.on('update-downloaded', (ev, releaseNotes, releaseName) => {
    log(opts, `update downloaded, release name: '${releaseName}'`)
    log(opts, `release notes: \n'${releaseNotes}'`)
    queue.dispatch(selfUpdateDownloaded(releaseName))
  })

  queue.dispatch(checkForSelfUpdate())
  setInterval(() => queue.dispatch(checkForSelfUpdate()), UPDATE_INTERVAL)

  yield call(queue.exhaust)
}

export function * _checkForSelfUpdate () {
  // TODO: fallback, like showing a dialog talking about updates on linux
  // with a link to where they can get them
  if (!autoUpdater) {
    log(opts, 'not checking for self update, got no auto-updater')
    return
  }

  log(opts, 'checking for self updates...')
  autoUpdater.checkForUpdates()
}

export function * _applySelfUpdate () {
  if (!autoUpdater) {
    log(opts, 'not applying self update, got no auto-updater')
    return
  }

  log(opts, 'quitting and installing..')
  autoUpdater.quitAndInstall()
}

export default function * setupSaga () {
  yield [
    takeEvery(BOOT, _boot),
    takeEvery(CHECK_FOR_SELF_UPDATE, _checkForSelfUpdate),
    takeEvery(APPLY_SELF_UPDATE, _applySelfUpdate)
  ]
}