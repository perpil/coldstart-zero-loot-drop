function handler(event) {
  let r = event.request,
    m = r.method,
    c = event.context;
  try {
    if (m !== 'PUT') {
      throw new Error('Unsupported HTTP Method');
    }
    if (!r.querystring['s'] || !r.querystring['s'].value) {
      throw new Error('Missing s query parameter');
    }
    if (
      !r.headers['content-length'] ||
      !r.headers['content-length'].value ||
      '0' !== r.headers['content-length'].value
    ) {
      throw new Error('Content-Length header must be 0');
    }
    if (r.querystring['s'].value.length > 1800) {
      throw new Error('s query parameter exceeds max length');
    }
    r.uri = `/r/${c.requestId}`;
    r.headers['x-amz-meta-s'] = { value: r.querystring['s'].value };
    r.querystring = '';
    return r;
  } catch (e) {
    return {
      statusCode: 400,
      statusDescription: 'Bad Request',
      body: e.message,
    };
  }
}
