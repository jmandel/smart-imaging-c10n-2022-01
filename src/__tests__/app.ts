import request from 'supertest'
import {Express} from 'express-serve-static-core'

import {createApp} from '../app'

let server: Express = createApp();

describe('GET /hello', () => {

  it('should return 200 & valid response if request param list is empity', async done => {
    let res = await request(server).get(`/hello`)
    expect(res.text).toMatch("obHello")
    done()
  })
})

