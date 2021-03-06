const { uniq } = require('ramda')
const table = require('markdown-table')
const { Op } = require('sequelize')
const { User, Entry } = require('./models')
const regex = require('./regex')
const { Currencies } = require('./enums')
const { sequelize } = require('./db')

const HELP = `Accounting Helper

  Usage:
  \`/help\` — this help
  \`/revert\` — revert last entry
  \`<amount> [<comment with hashtags>]\` — add new entry, e.g. \`150 awesome #burger and #cola\`. Comment is optional. Hashtags using for grouping entries and making reports by categories.

  [Icon by monkik](https://www.flaticon.com/free-icon/calculator_755173)
`.split('\n').map(s => s.trim()).join('\n')

const MSG_OPTS = {
  parse_mode: 'markdown',
  disable_web_page_preview: true
}

/**
 * Register user
 */
function start (bot, data) {
  const { from: { id } } = data
  return sequelize.transaction(async transaction => {
    const user = await User.find({
      where: { telegramId: String(id) },
      transaction
    })

    if (!user) {
      await User.create({ telegramId: id }, { transaction })
    }

    help(bot, data)
  })
}

async function help (bot, { from: { id } }) {
  bot.sendMessage(id, HELP, MSG_OPTS)
}

/**
 * Add Entry
 */
async function add (bot, data) {
  const matches = data.text.match(regex.entry)

  if (!matches || !matches.length) {
    bot.sendMessage(data.from.id, 'I don\'t understand you')
    return
  }

  const value = parseFloat(matches[1].trim())
  const comment = (matches[2] || '').trim()
  const tags = uniq(comment.match(regex.tags) || [])

  const currency = Currencies.RUB.toString()
  const user = await User.find({ where: { telegramId: String(data.from.id) } })

  const entry = await Entry.create({
    userId: user.id,
    value,
    currency,
    tags,
    comment
  })

  bot.sendMessage(data.from.id, `Added: ${entry.value}${entry.currency}`)
}

async function revert (bot, data) {
  const user = await User.find({ where: { telegramId: String(data.from.id) } })
  const entry = await Entry.find({
    where: { userId: user.id },
    order: [
      [ 'createdAt', 'DESC' ]
    ]
  })
  await entry.destroy({})

  bot.sendMessage(
    data.from.id,
    `Reverted: ${entry.value}${entry.currency}`,
    MSG_OPTS
  )
}

async function report (bot, data) {
  const user = await User.find({ where: { telegramId: String(data.from.id) } })
  const tags = uniq(data.text.match(regex.tags) || [])

  const criteria = [
    { 'user_id': user.id },
    sequelize.where(
      sequelize.fn('date', sequelize.col('created_at')),
      { [Op.between]: [
        sequelize.fn('to_timestamp', Math.round(Date.now() / 1000) - 7 * 24 * 3600),
        sequelize.fn('to_timestamp', Math.round(Date.now() / 1000))
      ] }
    )
  ]

  if (tags.length) {
    criteria.push({
      tags: {
        [Op.contains]: tags
      }
    })
  }

  const entries = await Entry.findAll({
    attributes: [
      [ sequelize.fn('date', sequelize.col('created_at')), 'date' ],
      [ sequelize.fn('sum', sequelize.col('value')), 'sum' ]
    ],
    group: [ sequelize.fn('date', sequelize.col('created_at')) ],
    where: criteria
  })

  const rendered = table([
    [ 'date', 'amount' ],
    ...entries.map(entry =>
      [ entry.getDataValue('date'), entry.getDataValue('sum') ])
  ])

  bot.sendMessage(
    data.from.id,
    `Report for last week:\n\n\`\`\`\n${rendered}\n\`\`\``,
    MSG_OPTS
  )
}

async function dump (bot, { from: { id } }) {
  bot.sendMessage(
    id,
    'dump is not available yet',
    MSG_OPTS
  )
}

module.exports = {
  start: bot => (...args) => start(bot, ...args).catch(console.log),
  help: bot => (...args) => help(bot, ...args).catch(console.log),
  add: bot => (...args) => add(bot, ...args).catch(console.log),
  revert: bot => (...args) => revert(bot, ...args).catch(console.log),
  report: bot => (...args) => report(bot, ...args).catch(console.log),
  dump: bot => (...args) => dump(bot, ...args).catch(console.log)
}
