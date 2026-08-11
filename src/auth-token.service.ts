import { EntityManager } from 'typeorm'

import { decodeJWTToken, generateJWTToken, validateProps, VerifyJWTResult, verifyJWTToken } from './common.service'
import { AuthTokenModel, getRepository, UserModel } from './repository'

const getAUser = async (options: { id?: string }, transaction?: EntityManager) =>
  (await getRepository('user', transaction).findOne({ where: { ...options } })) as UserModel | null

export const createAnAuthToken = async (data: Record<string, unknown>, transaction?: EntityManager) => {
  const repository = getRepository('auth_token', transaction)
  return (await repository.save(repository.create(data as Partial<AuthTokenModel>))) as AuthTokenModel
}

export const readAnAuthToken = async (options: Record<string, unknown>, transaction?: EntityManager) =>
  (await getRepository('auth_token', transaction).findOne({ where: options })) as AuthTokenModel | null

export const updateAnAuthToken = async (
  params: { data: Record<string, unknown>; options: Record<string, unknown> },
  transaction?: EntityManager
) => {
  const { data, options } = params || {}
  const authToken = await readAnAuthToken(options, transaction)
  if (!authToken?.id) {
    throw new Error('AUTH_TOKEN_IS_NOT_FOUND')
  }

  await getRepository('auth_token', transaction).update(authToken.id, data as Partial<AuthTokenModel>)

  return { ...authToken, ...data }
}

export const deleteAnAuthToken = async (options: Record<string, unknown>, transaction?: EntityManager) => {
  const authToken = await readAnAuthToken(options, transaction)
  if (!authToken?.id) {
    throw new Error('AUTH_TOKEN_IS_NOT_FOUND')
  }

  await getRepository('auth_token', transaction).delete(authToken.id)

  return authToken
}

export const deleteAuthTokensForUser = async (options: Record<string, unknown>, transaction?: EntityManager) =>
  getRepository('auth_token', transaction).delete(options)

export interface CreateAuthTokensParams {
  app_user_id?: string | null
  contact_id?: string | null
  offer_id?: string | null
  org_brand_id?: string | null
  org_id?: string | null
  roles?: string[]
  user_id?: string | null
  first_name?: string | null
  last_name?: string | null
  [key: string]: unknown
}

export const createAuthTokensForUser = async (params: CreateAuthTokensParams = {}, transaction?: EntityManager) => {
  const {
    app_user_id = null,
    contact_id = null,
    offer_id = null,
    org_brand_id = null,
    org_id = null,
    roles,
    user_id = null
  } = params || {}

  const accessTokenExpiry = process.env.ACCESS_TOKEN_EXPIRY || '1d'
  const refreshTokenExpiry = process.env.REFRESH_TOKEN_EXPIRY || '30d'

  const accessTokenParams: CreateAuthTokensParams = { roles, sub: app_user_id || contact_id || user_id }
  const refreshTokenParams: CreateAuthTokensParams = { sub: app_user_id || contact_id || user_id }

  if (contact_id) {
    accessTokenParams.contact_id = contact_id
    refreshTokenParams.contact_id = contact_id
  }
  if (org_brand_id) {
    accessTokenParams.org_brand_id = org_brand_id
  }
  if (offer_id) {
    accessTokenParams.offer_id = offer_id
  }
  if (org_id) accessTokenParams.org_id = org_id
  if (user_id) {
    accessTokenParams.user_id = user_id
    refreshTokenParams.user_id = user_id
  }

  const access_token = generateJWTToken(accessTokenParams, accessTokenExpiry)
  const refresh_token = generateJWTToken(refreshTokenParams, refreshTokenExpiry)

  const authToken = await createAnAuthToken({ access_token, contact_id, refresh_token, user_id }, transaction)
  if (!authToken?.id) {
    throw new Error('COULD_NOT_CREATE_AUTH_TOKEN')
  }

  return { access_token, refresh_token }
}

export interface VerifyAuthTokenParams {
  token: string
  type: string
}

export const verifyAnAuthTokenForUser = async (
  params: VerifyAuthTokenParams = {} as VerifyAuthTokenParams,
  transaction?: EntityManager
): Promise<VerifyJWTResult> => {
  validateProps(
    [
      { field: 'token', required: true, type: 'string' },
      { field: 'type', required: true, type: 'string' }
    ],
    params
  )

  const { token, type } = params || {}
  if (!['access_token', 'refresh_token'].includes(type)) {
    throw new Error('TOKEN_TYPE_IS_INVALID')
  }

  const { contact_id, user_id } = decodeJWTToken(token) || {}
  const where: Record<string, unknown> = { [type]: token }
  if (contact_id) where.contact_id = contact_id
  else if (user_id) where.user_id = user_id
  else throw new Error('MISSING_REQUIRED_FIELDS')

  const authToken = await readAnAuthToken(where, transaction)
  if (!authToken?.id) {
    return { message: 'INVALID_TOKEN', success: false }
  }

  return verifyJWTToken(token)
}

export interface RefreshTokensParams {
  custom_claims: CreateAuthTokensParams
  refresh_token: string
}

export const refreshAuthTokensForUser = async (
  params: RefreshTokensParams = {} as RefreshTokensParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'custom_claims', required: true, type: 'object' },
      { field: 'refresh_token', required: true, type: 'string' }
    ],
    params
  )
  validateProps(
    [
      { field: 'contact_id', required: false, type: 'string' },
      { field: 'org_brand_id', required: false, type: 'string' },
      { field: 'org_id', required: false, type: 'string' },
      { field: 'roles', required: true, type: 'object' },
      { field: 'user_id', required: false, type: 'string' }
    ],
    (params?.custom_claims || {}) as Record<string, unknown>
  )

  const { custom_claims, refresh_token } = params || {}
  if (!(custom_claims?.contact_id || custom_claims?.user_id)) {
    throw new Error('MISSING_REQUIRED_FIELDS')
  }
  if (custom_claims?.contact_id && custom_claims?.user_id) {
    throw new Error('CANNOT_HAVE_BOTH_CONTACT_ID_AND_USER_ID')
  }

  const { contact_id, user_id } = (decodeJWTToken(refresh_token) || {}) as { contact_id?: string; user_id?: string }
  const authToken = await readAnAuthToken({ refresh_token }, transaction)
  if (!authToken?.id) {
    throw new Error('REFRESH_TOKEN_IS_INVALID')
  }

  const paramsForNewToken = { ...custom_claims }
  if (authToken?.contact_id && contact_id) {
    paramsForNewToken.contact_id = contact_id
  } else if (authToken?.user_id && user_id) {
    const user = await getAUser({ id: authToken.user_id }, transaction)
    if (!user?.id) {
      throw new Error('USER_IS_NOT_FOUND')
    }
    if (!(user?.status === 'active')) {
      throw new Error('USER_IS_NOT_ACTIVE')
    }
    paramsForNewToken.first_name = user?.first_name
    paramsForNewToken.last_name = user?.last_name
    paramsForNewToken.user_id = user_id
  }

  await deleteAnAuthToken({ id: authToken.id }, transaction)

  return createAuthTokensForUser(paramsForNewToken, transaction)
}

export interface RevokeAuthTokenParams {
  token: string
  type: string
}

export const revokeAnAuthTokenForUser = async (
  params: RevokeAuthTokenParams = {} as RevokeAuthTokenParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'token', required: true, type: 'string' },
      { field: 'type', required: true, type: 'string' }
    ],
    params
  )

  const { token, type } = params || {}
  if (!['access_token', 'refresh_token'].includes(type)) {
    throw new Error('TOKEN_TYPE_IS_INVALID')
  }

  const deletedCount = await deleteAuthTokensForUser({ [type]: token }, transaction)
  if (deletedCount?.affected === undefined || deletedCount?.affected <= 0) {
    return { message: 'INVALID_TOKEN', success: false }
  }

  return { message: 'LOGGED_OUT', success: true }
}

export const revokeAuthTokensForUser = async (
  params: { user_id: string } = {} as { user_id: string },
  transaction?: EntityManager
) => {
  validateProps([{ field: 'user_id', required: true, type: 'string' }], params)

  const { user_id } = params || {}
  const user = await getAUser({ id: user_id }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'active')) {
    throw new Error('USER_IS_NOT_ACTIVE')
  }

  const deletedCount = await deleteAuthTokensForUser({ user_id }, transaction)
  if (deletedCount?.affected === undefined || deletedCount?.affected <= 0) {
    return { message: 'INVALID_TOKEN', success: false }
  }

  return { message: 'LOGGED_OUT', success: true }
}
