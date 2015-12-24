
let r = require('r-dom')
let mori = require('mori')
let PropTypes = require('react').PropTypes
let translate = require('react-i18next').translate
let ShallowComponent = require('./shallow-component')

let GameList = require('./game-list')
let LibraryPlaceholder = require('./library-placeholder')
let PreferencesForm = require('./preferences-form')

/**
 * A list of games corresponding to whatever library tab is selected
 */
class LibraryContent extends ShallowComponent {
  render () {
    let state = this.props.state
    let panel = mori.getIn(state, ['library', 'panel'])

    let children = []

    if (panel === 'preferences') {
      children.push(r(PreferencesForm, {state}))
    } else {
      let caves = mori.getIn(state, ['library', 'caves'])
      let games = mori.getIn(state, ['library', 'games'])

      let bucket = (panel === 'broken' ? 'caved' : panel)
      let shown_games = mori.get(games, bucket) || mori.list()

      // FIXME this logic goes wrong - sometimes stuff gets stuck in 'broken'
      let pred = () => true
      if (panel === 'caved') {
        pred = (cave) => mori.get(cave, 'task') !== 'error'
      }
      if (panel === 'broken') {
        pred = (cave) => mori.get(cave, 'task') === 'error'
      }

      let owned_games_by_id = mori.merge(mori.get(games, 'dashboard'), mori.get(games, 'owned'))

      if (mori.count(shown_games) > 0) {
        children.push(r(GameList, {games: shown_games, caves, pred, owned_games_by_id}))
      } else {
        children.push(r(LibraryPlaceholder, {panel}))
      }
    }

    return r.div({className: 'main_content'}, children)
  }
}

LibraryContent.propTypes = {
  state: PropTypes.any
}

module.exports = translate('library-content')(LibraryContent)