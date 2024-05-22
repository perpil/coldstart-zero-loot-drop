import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Reference } from 'aws-cdk-lib';
import { S3OriginProps, S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnOriginAccessControl } from 'aws-cdk-lib/aws-cloudfront';
import { Source, BucketDeployment } from 'aws-cdk-lib/aws-s3-deployment';

// To use OAC instead of OAI, we need to patch the S3Origin class
// https://github.com/aws/aws-cdk/issues/21771#issuecomment-2081710100

type S3OriginWithOACPatchProps = S3OriginProps & {
  originAccessControlId: Reference;
};

class S3OriginWithOACPatch extends S3Origin {
  private readonly originAccessControlId: Reference;

  constructor(bucket: s3.IBucket, props: S3OriginWithOACPatchProps) {
    super(bucket, props);
    this.originAccessControlId = props.originAccessControlId;
  }

  public bind(
    scope: Construct,
    options: cloudfront.OriginBindOptions
  ): cloudfront.OriginBindConfig {
    const originConfig = super.bind(scope, options);

    if (!originConfig.originProperty)
      throw new Error('originProperty is required');

    return {
      ...originConfig,
      originProperty: {
        ...originConfig.originProperty,
        originAccessControlId: this.originAccessControlId.toString(),
        s3OriginConfig: {
          ...originConfig.originProperty.s3OriginConfig,
          originAccessIdentity: '',
        },
      },
    };
  }
}

function createCFFunction(scope: Construct, id: string) {
  return new cloudfront.Function(scope, `${id}Fn`, {
    code: cloudfront.FunctionCode.fromFile({
      filePath: `cloudfront-functions/${id}.js`,
    }),
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    functionName: id,
  });
}

export class SearchUrlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const origin = new s3.Bucket(this, 'Origin', {
      bucketName: `coldstart-zero-lootdrop-origin-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          prefix: 'r/',
          expiration: cdk.Duration.days(1),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

    new BucketDeployment(this, 'DeployWebsite', {
      sources: [Source.asset('./website/dist')],
      destinationBucket: origin,
      prune: false,
    });

    const s3BucketOAC = new CfnOriginAccessControl(this, 's3-bucket-OAC', {
      originAccessControlConfig: {
        name: 's3-bucket-OAC',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    // By using s3.Bucket.fromBucketName instead of origin, it doesn't add the OAI policy to the bucket resource policy
    // https://github.com/aws/aws-cdk/issues/21771#issuecomment-2094497498
    const s3BucketOrigin = new S3OriginWithOACPatch(
      s3.Bucket.fromBucketName(this, 'OriginBucket', origin.bucketName),
      {
        originAccessControlId: s3BucketOAC.getAtt('Id'),
      }
    );

    const apiRequestFn = createCFFunction(this, 'czldAPIRequest');
    const apiResponseFn = createCFFunction(this, 'czldAPIResponse');
    const redirectFn = createCFFunction(this, 'czldRedirect');

    let distro = new cloudfront.Distribution(this, 'distro', {
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: s3BucketOrigin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        compress: true,
      },
      defaultRootObject: 'index.html',
      comment: 'Coldstart Zero Loot Drop Distribution',
      additionalBehaviors: {
        '/r/*': {
          origin: s3BucketOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          functionAssociations: [
            {
              function: redirectFn,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
        '/api': {
          origin: s3BucketOrigin,
          //Allow PUT requests to the /api path
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: apiRequestFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
            {
              function: apiResponseFn,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
      },
    });

    // Add OAC policy to the bucket that allows read of all objects, and write of objects in the r/ prefix
    origin.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [origin.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distro.distributionId}`,
          },
        },
      })
    );

    origin.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [origin.arnForObjects('r/*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distro.distributionId}`,
          },
        },
      })
    );

    new cdk.CfnOutput(this, 'Url', {
      value: `https://${distro.distributionDomainName}`,
    });
  }
}
