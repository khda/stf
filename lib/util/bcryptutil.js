/* eslint-disable no-sync */
var bcrypt = require('bcrypt')

module.exports.hash = function(password) {
  return bcrypt.hashSync(password, 10)
}

module.exports.compare = function(password, hash) {
  return bcrypt.compareSync(password, hash)
}
