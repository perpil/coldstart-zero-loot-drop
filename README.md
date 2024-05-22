# CloudFront As a Lightweight Proxy

This is the companion repo for the blog post: [Using CloudFront as a Lightweight Proxy](https://speedrun.nobackspacecrew.com/blog/2024/05/22/using-cloudfront-as-a-lightweight-proxy.html) The stack will create a Google Url Bookmark service that only uses CloudFront and S3.

## Interesting files

1. [`lib/searchurl-stack.ts`](lib/searchurl-stack.ts) - The CDK stack that creates the CloudFront distribution, CloudFront functions, OAC, S3 bucket and lifecycle policy to clean up the bucket.
1. [`cloudfront-functions/czldAPIRequest.js`](cloudfront-functions/czldAPIRequest.js): The CloudFront function to rewrite the s3 object key and add search terms as metadata
1. [`cloudfront-functions/czldAPIResponse.js`](cloudfront-functions/czldAPIResponse.js): The CloudFront function to create a json response with the resulting url
1. [`cloudfront-functions/czldRedirect.js`](cloudfront-functions/czldRedirect.js): The CloudFront function extract the search terms from S3 metadata and redirect to Google
1. [`cloudfront-functions/czldPost.js`](cloudfront-functions/czldPost.js): A CloudFront function unused in this stack, but that creates a presigned form to post to S3.

## Setup

```
npm install
```

If you've never used the [CDK](https://aws.amazon.com/cdk/) before, run:

```
npx cdk bootstrap
```

## Deploy

```
npx cdk deploy
```

## Usage

**Outputs** will print a the url for the CloudFront distribution.

```
SearchUrlStack.Url = https://dxxxxxxxxxxxx.cloudfront.net
```

Enter your search terms and click `Persist`. The resulting url will load a file from S3 and redirect to Google with the search terms you originally entered.

## Tearing it down

```
npx cdk destroy
```

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
