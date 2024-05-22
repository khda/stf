/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var http = require('http')

var express = require('express')
var validator = require('express-validator')
var cookieSession = require('cookie-session')
var bodyParser = require('body-parser')
var serveStatic = require('serve-static')
var csrf = require('csurf')
var Promise = require('bluebird')

var logger = require('../../util/logger')
var requtil = require('../../util/requtil')
var ldaputil = require('../../util/ldaputil')
var bcryptutil = require('../../util/bcryptutil')
var jwtutil = require('../../util/jwtutil')
var pathutil = require('../../util/pathutil')
var urlutil = require('../../util/urlutil')
var lifecycle = require('../../util/lifecycle')

const dbapi = require('../../db/api')

module.exports = function(options) {
  var log = logger.createLogger('auth-local')
  var app = express()
  var server = Promise.promisifyAll(http.createServer(app))

  log.info('[lib/units/auth/local]')
  // log.info('[lib/units/auth/local]:', options)

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/local/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))
  app.use(bodyParser.json())
  app.use(csrf())
  app.use(validator())
  app.use('/static/bower_components',
    serveStatic(pathutil.resource('bower_components')))
  app.use('/static/auth/local', serveStatic(pathutil.resource('auth/local')))

  app.use(function(req, res, next) {
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  app.get('/', function(req, res) {
    res.redirect('/auth/local/')
  })

  app.get('/auth/contact', function(req, res) {
    dbapi.getRootGroup().then(function(group) {
      res.status(200)
        .json({
          success: true
        , contact: group.owner
        })
    })
    .catch(function(err) {
      log.error('Unexpected error', err.stack)
      res.status(500)
        .json({
          success: false
        , error: 'ServerError'
        })
      })
  })

  app.get('/auth/local/', function(req, res) {
    res.render('index')
  })

  app.post('/auth/api/v1/local', function(req, res) {
    var log = logger.createLogger('auth-local')
    log.setLocalIdentifier(req.ip)
    switch (req.accepts(['json'])) {
      case 'json':
        requtil.validate(req, function() {
            req.checkBody('email').isEmail()
            req.checkBody('password').notEmpty()
          })
          .then(function() {
            return dbapi.loadUser(req.body.email).then(function(user) {
              log.info('user:', user)

              if (user) {
                if (bcryptutil.compare(req.body.password, user.password)) {
                  return user
                }
                else {
                  log.warn('User password uncorrect: "%s"!', req.body.email)
                }
              }
              else {
                log.warn('User not found by email: "%s"!', req.body.email)
              }

              throw new ldaputil.InvalidCredentialsError(req.body.email)
            })
          })
          .then(function(user) {
            log.info('Authenticated "%s"', user.email)
            var token = jwtutil.encode({
              payload: {
                email: user.email
              , name: user.name
              }
            , secret: options.secret
            , header: {
                exp: Date.now() + 24 * 3600
              }
            })
            res.status(200)
              .json({
                success: true
              , redirect: urlutil.addParams(options.appUrl, {
                  jwt: token
                })
              })
          })
          .catch(requtil.ValidationError, function(err) {
            res.status(400)
              .json({
                success: false
              , error: 'ValidationError'
              , validationErrors: err.errors
              })
          })
          .catch(ldaputil.InvalidCredentialsError, function(err) {
            log.warn('Authentication failure for "%s"', err.user)
            res.status(401)
              .json({
                success: false
              , error: 'InvalidCredentialsError'
              })
          })
          .catch(function(err) {
            log.error('Unexpected error', err.stack)
            res.status(500)
              .json({
                success: false
              , error: 'ServerError'
              })
          })
        break
      default:
        res.send(406)
        break
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
