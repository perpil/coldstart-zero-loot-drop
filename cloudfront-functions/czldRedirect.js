function handler(event) {
  const response = event.response,
    headers = response.headers,
    header = 'x-amz-meta-s';
  if (
    event.request.method == 'GET' &&
    response.statusCode == 200 &&
    headers['content-length'].value == '0'
  ) {
    if (headers[header] && headers[header].value) {
      headers.location = {
        value: `https://www.google.com/search?q=${headers[header].value}`,
      };
      return {
        statusCode: 302,
        statusDescription: 'Found',
        headers,
      };
    }
  }
  return response;
}
