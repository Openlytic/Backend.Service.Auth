import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const secret = (): string => process.env.JWT_SECRET || 'dev-openlytic-jwt'

export const getRandomNumber = (length: number): string => {
  const characters = '0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length)
    result += characters.charAt(randomIndex)
  }
  return result
}

export const getRandomString = (length: number): string => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length)
    result += characters.charAt(randomIndex)
  }
  return result
}

export const checkPasswordPolicy = (password: string): boolean => {
  if (password?.length < 8) return false
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[-+_!@#$%^&*.,?]).+$/
  return regex.test(password)
}

export const compareHashPassword = (str = '', hashStr?: string | null): boolean => {
  if (!str || !hashStr) return false
  return bcrypt.compareSync(str, hashStr)
}

export const checkOldPasswords = (newPassword: string, oldPasswords: string[] = []): boolean =>
  oldPasswords.some((password) => compareHashPassword(newPassword, password))

export const generateHashPassword = (str = ''): string => bcrypt.hashSync(str, 10)

interface JWTClaims {
  sub?: string
  aud?: string
  jti?: string
  [key: string]: unknown
}

export const generateJWTToken = (payload: JWTClaims = {}, expiresIn: string | number = '1h'): string =>
  jwt.sign(
    {
      iss: getAppDomain(),
      sub: payload?.sub || getRandomString(17),
      aud: payload?.aud || getRandomString(17),
      jti: payload?.jti || getRandomString(17),
      ...payload
    },
    secret(),
    { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] }
  )

export const decodeJWTToken = (token: string): JWTClaims | null => jwt.decode(token) as JWTClaims | null

export interface VerifyJWTResult {
  message: string
  payload?: JWTClaims
  success: boolean
}

export const verifyJWTToken = (token: string): VerifyJWTResult => {
  try {
    const payload = jwt.verify(token, secret()) as JWTClaims
    return { message: 'TOKEN_IS_VERIFIED', payload, success: true }
  } catch (err) {
    return {
      message: (err as Error)?.message?.replaceAll(' ', '_')?.toUpperCase() || 'TOKEN_IS_INVALID',
      success: false
    }
  }
}

export interface ValidationField {
  field: string
  required: boolean
  type: string
}

const isEmpty = (value: unknown): boolean => {
  if (typeof value === 'boolean') return false
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.length === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

export const validateProps = (fields: ValidationField[], body: object = {}): void => {
  const record = body as Record<string, unknown>
  const allowedFields = fields.map((field) => field.field)
  const notAllowedFields = Object.keys(record).filter((key) => !allowedFields.includes(key))
  if (notAllowedFields.length) {
    throw new Error(`${notAllowedFields.join('_AND_').toUpperCase()}_NOT_ALLOWED`)
  }

  const invalidFields: string[] = []
  const missingFields: string[] = []
  for (const { field, required, type } of fields) {
    if (typeof record[field] !== 'undefined' && typeof record[field] !== type) {
      invalidFields.push(field)
    }
    if (required && !(typeof record[field] === 'boolean') && isEmpty(record[field])) {
      missingFields.push(field)
    }
  }

  if (invalidFields.length) {
    throw new Error(`INVALID_TYPE_OF_${invalidFields.join('_AND_').toUpperCase()}`)
  }
  if (missingFields.length) {
    throw new Error(`MISSING_${missingFields.join('_AND_').toUpperCase()}`)
  }
}

export const getAppName = (): string => process.env.COPILOT_APPLICATION_NAME || 'openlytic'

export const getAppDomain = (): string => {
  const domainMaps: Record<string, string> = {
    openlytic: 'openlytic.app',
    gain: 'gain.io',
    payrun: 'payrun.app',
    easydesk: 'easydesk.app'
  }
  return domainMaps[getAppName()] || 'openlytic.app'
}

export const getAppURL = (): string => process.env.APP_URL || `https://${getAppDomain()}`
