const https = require('https');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientSecret) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'LINKEDIN_CLIENT_SECRET env var not set in Netlify dashboard.' })
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { action, code, accessToken, text, personUrn, redirectUri, clientId } = payload;

  try {
    // ── EXCHANGE auth code for access token + person info ──────────────
    if (action === 'exchange') {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret
      }).toString();

      const tokenRes = await request({
        hostname: 'www.linkedin.com',
        path: '/oauth/v2/accessToken',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params)
        }
      }, params);

      if (tokenRes.status !== 200) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: tokenRes.body }) };
      }

      const token = tokenRes.body.access_token;

      // Get person ID
      const meRes = await request({
        hostname: 'api.linkedin.com',
        path: '/v2/me',
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (meRes.status !== 200) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: meRes.body }) };
      }

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          accessToken: token,
          personUrn: `urn:li:person:${meRes.body.id}`,
          name: `${meRes.body.localizedFirstName} ${meRes.body.localizedLastName}`
        })
      };

    // ── POST content to LinkedIn ────────────────────────────────────────
    } else if (action === 'post') {
      const postBody = JSON.stringify({
        author: personUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      });

      const postRes = await request({
        hostname: 'api.linkedin.com',
        path: '/v2/ugcPosts',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postBody),
          'X-Restli-Protocol-Version': '2.0.0'
        }
      }, postBody);

      if (postRes.status === 201) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
      } else {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: postRes.body }) };
      }

    } else {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
    }

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
