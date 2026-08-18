import { requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { clearSessionCookie } from '../_lib/session.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  clearSessionCookie(response)
  sendJson(response, 200, { success: true })
}
