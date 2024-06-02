function handler(event) {
  let res = event.response,
    req = event.request;
  if (res.statusCode != 200) {
    return res;
  }
  res.headers['content-type'] = { value: 'application/json' };
  res.body = JSON.stringify({
    cfRequestId: event.context.requestId,
    url: `https://${event.context.distributionDomainName}${req.uri}`,
  });
  return res;
}
