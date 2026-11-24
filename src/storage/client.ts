import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { env } from "../config"
import { buildObjectKey, contentHash } from "./keys"

let s3: S3Client | null = null

function getS3Client(): S3Client {
  s3 ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  })
  return s3
}

interface PutObjectResult {
  objectKey: string
  contentHash: string
  byteSize: number
}

/** Store private bytes under an opaque key. The bucket must already exist. */
export async function putObject(params: {
  tenantId: string
  body: string
  contentType: string
}): Promise<PutObjectResult> {
  const body = Buffer.from(params.body, "utf8")
  const hash = contentHash(body)
  const objectKey = buildObjectKey(params.tenantId, hash)

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: objectKey,
      Body: body,
      ContentType: params.contentType,
    })
  )

  return { objectKey, contentHash: hash, byteSize: body.byteLength }
}
