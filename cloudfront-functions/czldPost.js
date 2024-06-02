const crypto = require('crypto');
import cf from 'cloudfront';
const kvsId = 'REPLACE_WITH_YOUR_KVS_ID';
const kvsHandle = cf.kvs(kvsId);

const ALGORITHM_QUERY_PARAM = 'X-Amz-Algorithm';
const ALGORITHM_IDENTIFIER = 'AWS4-HMAC-SHA256';
const CREDENTIAL_QUERY_PARAM = 'X-Amz-Credential';
const AMZ_DATE_QUERY_PARAM = 'X-Amz-Date';
const SIGNATURE_QUERY_PARAM = 'X-Amz-Signature';
const KEY_TYPE_IDENTIFIER = 'aws4_request';

function hmac(key, string) {
  return crypto.createHmac('sha256', key).update(string, 'utf8').digest();
}

function iso8601(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function createScope(date, region, service) {
  return [date, region, service, 'aws4_request'].join('/');
}

function getSigningKey(credentials, shortDate, region, service) {
  let key = `AWS4${credentials.secretAccessKey}`;
  [shortDate, region, service, KEY_TYPE_IDENTIFIER].forEach((signable) => {
    key = hmac(key, signable);
  });
  return key;
}

function addIfNew(arr, value) {
  if (!arr.includes(value)) {
    arr.push(value);
  }
}

function formatDate() {
  let now = new Date(),
    signingDate = iso8601(now).replace(/[\-:]/g, '');
  return { now, signingDate, shortDate: signingDate.slice(0, 8) };
}

function requestSigner(key, region, credentials, conditions, fields, expires) {
  conditions = conditions ? conditions : [];
  fields = fields ? fields : {};
  expires = expires ? expires : 3600;
  const d = formatDate();
  const now = d.now,
    signingDate = d.signingDate,
    shortDate = d.shortDate;
  const clientRegion = region;
  const credential = `${credentials.accessKeyId}/${createScope(
    shortDate,
    clientRegion,
    's3'
  )}`;
  fields = Object.assign(Object.assign({}, fields), {
    [ALGORITHM_QUERY_PARAM]: ALGORITHM_IDENTIFIER,
    [CREDENTIAL_QUERY_PARAM]: credential,
    [AMZ_DATE_QUERY_PARAM]: signingDate,
  });
  const expiration = new Date(now.getTime() + expires * 1000);
  const conditionsArr = [];
  conditions.forEach((condition) => {
    addIfNew(conditionsArr, JSON.stringify(condition));
  });
  Object.keys(fields).forEach((key) => {
    addIfNew(conditionsArr, JSON.stringify({ [key]: fields[key] }));
  });
  if (key.endsWith('${filename}')) {
    addIfNew(
      conditionsArr,
      JSON.stringify([
        'starts-with',
        '$key',
        key.substring(0, key.lastIndexOf('${filename}')),
      ])
    );
  } else {
    addIfNew(conditionsArr, JSON.stringify({ key }));
  }
  const encodedPolicy = Buffer.from(
    JSON.stringify({
      expiration: iso8601(expiration),
      conditions: conditionsArr.map((item) => JSON.parse(item)),
    })
  ).toString('base64');
  const signingKey = getSigningKey(credentials, shortDate, clientRegion, 's3');
  const signature = hmac(signingKey, encodedPolicy);
  return {
    fields: Object.assign(Object.assign({}, fields), {
      key,
      Policy: encodedPolicy,
      [SIGNATURE_QUERY_PARAM]: signature.toString('hex'),
    }),
  };
}

async function handler(event) {
  const request = event.request;
  const method = request.method;
  const region = 'us-east-2';
  const path = `r/${event.context.requestId}`;
  try {
    if (['GET'].includes(method)) {
      const credentials = {
        accessKeyId: await kvsHandle.get('ACCESS_KEY', { format: 'string' }),
        secretAccessKey: await kvsHandle.get('SECRET_KEY', {
          format: 'string',
        }),
      };
      const success_action_redirect = `https://${event.context.distributionDomainName}/${path}`;
      const conditions = [
        { acl: 'bucket-owner-full-control' },
        ['eq', '$key', path],
        ['starts-with', '$bucket', ''],
        ['content-length-range', 1, 2],
        { success_action_redirect },
      ];
      const fields = {
        acl: 'bucket-owner-full-control',
        success_action_redirect,
        'content-type': 'text/plain; charset=utf-8',
      };
      const result = requestSigner(
        path,
        region,
        credentials,
        conditions,
        fields
      );
      const form = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/></head><body>
  <form action="/post" method="post" enctype="multipart/form-data">
    ${Object.keys(result.fields)
      .map(
        (key) =>
          `<input type='hidden' name="${key}" value="${result.fields[
            key
          ].replaceAll('"', '&quot;')}"/>`
      )
      .join('')}
    <input type="file" name="file"/><br />
    <input type="submit" name="submit" value="Upload to Amazon S3" />
  </form>
</html>`;
      return {
        statusCode: 200,
        statusDescription: 'OK',
        body: form,
      };
    } else {
      throw new Error('Only GET is supported');
    }
  } catch (e) {
    return {
      statusCode: 400,
      statusDescription: 'Bad Request',
      body: e.message,
    };
  }
}
