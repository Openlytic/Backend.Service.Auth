import { EntityManager, In, MoreThanOrEqual } from 'typeorm'

import {
  createAuthTokensForUser,
  deleteAuthTokensForUser,
  refreshAuthTokensForUser,
  revokeAnAuthTokenForUser,
  revokeAuthTokensForUser,
  verifyAnAuthTokenForUser
} from './auth-token.service'
import {
  checkOldPasswords,
  checkPasswordPolicy,
  compareHashPassword,
  generateHashPassword,
  validateProps
} from './common.service'
import { getRepository, UserModel } from './repository'
import {
  createAVerificationTokenAndSendNotification,
  deleteAVerificationToken,
  deleteVerificationTokens,
  readAVerificationToken,
  readVerificationTokens,
  updateVerificationTokens
} from './verification-token.service'

const VERIFICATION_TYPES = ['resend_user_verification', 'user_verification'] as const
const FORGOT_PASSWORD_TYPES = ['forgot_password', 'resend_forgot_password'] as const

interface SanitizedUser {
  [key: string]: unknown
  id: string
  email: string
  status: string
}

const sanitizeUser = (user: UserModel): SanitizedUser => {
  const { password, old_passwords, ...rest } = user
  return rest
}

const getAUser = async (options: Record<string, unknown> | Record<string, unknown>[], transaction?: EntityManager) =>
  (await getRepository('user', transaction).findOne({ where: options })) as UserModel | null

export interface RegisterPasswordParams {
  is_verification_required: boolean
  password: string
  user_id: string
}

export const registerPassword = async (
  params: RegisterPasswordParams = {} as RegisterPasswordParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'is_verification_required', required: true, type: 'boolean' },
      { field: 'password', required: true, type: 'string' },
      { field: 'user_id', required: true, type: 'string' }
    ],
    params
  )

  const { is_verification_required = true, password, user_id } = params || {}
  if (is_verification_required && !checkPasswordPolicy(password)) {
    throw new Error('PASSWORD_DID_NOT_CONFORM_OUR_POLICY')
  }

  const user = await getAUser({ id: user_id }, transaction)
  if (!user?.id) {
    throw new Error('USER_DOES_NOT_EXISTS')
  }

  const hashPassword = generateHashPassword(password)

  const updatingData: Partial<UserModel> = { password: hashPassword }
  if (is_verification_required) {
    updatingData.status = 'unverified'
  }

  await getRepository('user', transaction).update(user.id, updatingData)

  if (is_verification_required) {
    await createAVerificationTokenAndSendNotification(
      {
        ...sanitizeUser(user),
        type: 'user_verification',
        user_id
      },
      transaction
    )
  }

  return { ...sanitizeUser(user), ...updatingData }
}

export interface VerifyUserEmailParams {
  token: string
  user_id: string
}

export const verifyUserEmail = async (
  params: VerifyUserEmailParams = {} as VerifyUserEmailParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'token', required: true, type: 'string' },
      { field: 'user_id', required: true, type: 'string' }
    ],
    params
  )

  const { token, user_id } = params || {}
  const verificationToken = await readAVerificationToken(
    {
      status: 'unverified',
      type: In([...VERIFICATION_TYPES]),
      token,
      user_id
    },
    transaction
  )
  if (!verificationToken?.id) {
    throw new Error('OTP_IS_NOT_VALID')
  }
  if (new Date(verificationToken?.expired_at).getTime() < Date.now()) {
    throw new Error('OTP_IS_EXPIRED')
  }

  await deleteVerificationTokens({ type: In([...VERIFICATION_TYPES]), user_id }, transaction)

  const user = await getAUser({ id: user_id }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }

  await getRepository('user', transaction).update(user.id, { status: 'active' })

  return { ...sanitizeUser(user), status: 'active' }
}

export interface ResendUserVerificationEmailParams {
  email: string
  wrapper_html?: string
  variables?: Record<string, unknown>
}

export const resendUserVerificationEmail = async (
  params: ResendUserVerificationEmailParams = {} as ResendUserVerificationEmailParams,
  transaction?: EntityManager
) => {
  validateProps([{ field: 'email', required: true, type: 'string' }], params)

  const { email } = params || {}
  const user = await getAUser([{ email }, { new_email: email }], transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'unverified') && !user?.new_email) {
    throw new Error('USER_IS_ALREADY_VERIFIED')
  }

  const existingTokens = await readVerificationTokens(
    {
      order: { created_at: 'DESC' },
      where: {
        created_at: MoreThanOrEqual(new Date(Date.now() - 10 * 60 * 1000)),
        status: In(['cancelled', 'unverified']),
        type: 'resend_user_verification',
        user_id: user?.id
      }
    },
    transaction
  )
  if (existingTokens?.length >= 3) {
    throw new Error('TOO_MANY_RESEND_VERIFICATION_REQUESTS')
  }

  await updateVerificationTokens(
    {
      data: { status: 'cancelled' },
      options: {
        where: {
          status: 'unverified',
          type: In([...VERIFICATION_TYPES]),
          user_id: user?.id
        }
      }
    },
    transaction
  )

  await createAVerificationTokenAndSendNotification(
    {
      ...sanitizeUser(user),
      email,
      type: 'resend_user_verification',
      user_id: user?.id,
      wrapper_html: params?.wrapper_html,
      variables: params?.variables
    },
    transaction
  )

  return sanitizeUser(user)
}

export interface LoginParams {
  custom_claims: {
    org_brand_id?: string
    org_id?: string
    roles: string[]
    [key: string]: unknown
  }
  password: string
  user_id: string
}

export const loginAUser = async (params: LoginParams = {} as LoginParams, transaction?: EntityManager) => {
  validateProps(
    [
      { field: 'custom_claims', required: true, type: 'object' },
      { field: 'password', required: true, type: 'string' },
      { field: 'user_id', required: true, type: 'string' }
    ],
    params
  )
  validateProps(
    [
      { field: 'org_brand_id', required: false, type: 'string' },
      { field: 'org_id', required: false, type: 'string' },
      { field: 'roles', required: false, type: 'object' }
    ],
    (params?.custom_claims || {}) as Record<string, unknown>
  )

  const { custom_claims, password, user_id } = params || {}
  const user = await getAUser({ id: user_id }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'active')) {
    throw new Error(`USER_IS_${user?.status?.toUpperCase()}`)
  }
  if (!compareHashPassword(password, user?.password)) {
    throw new Error('PASSWORD_IS_INCORRECT')
  }
  if (user?.has_temp_password) {
    return { message: 'NEW_PASSWORD_REQUIRED', success: true }
  }

  return createAuthTokensForUser(
    { ...custom_claims, first_name: user?.first_name, last_name: user?.last_name, user_id },
    transaction
  )
}

export interface LoginAnApplicationParams {
  app_name: string
  org_brand_id?: string
  org_id?: string
  token: string
}

export const loginAnApplication = async (
  params: LoginAnApplicationParams = {} as LoginAnApplicationParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'app_name', required: true, type: 'string' },
      { field: 'org_brand_id', required: false, type: 'string' },
      { field: 'org_id', required: false, type: 'string' },
      { field: 'token', required: true, type: 'string' }
    ],
    params
  )
  if (!(params?.token === process.env.APPLICATION_TOKEN)) {
    throw new Error('INVALID_APPLICATION_TOKEN')
  }

  const { app_name = 'public' } = params || {}
  if (!['organization', 'public', 'service'].includes(app_name)) {
    throw new Error('APP_NAME_IS_INVALID')
  }
  if (app_name === 'organization' && !params?.org_id) {
    throw new Error('MISSING_ORG_ID')
  }

  const userAndRolesMappingObj: Record<string, { roles: string[]; user_id: string }> = {
    organization: { roles: ['public'], user_id: 'ORGANIZATION_APPLICATION' },
    public: { roles: ['public'], user_id: 'PUBLIC_APPLICATION' },
    service: { roles: ['service_manager'], user_id: 'SERVICE_APPLICATION' }
  }
  const appUser = await getAUser({ email: userAndRolesMappingObj[app_name]?.user_id }, transaction)
  if (!appUser?.id) {
    throw new Error('APPLICATION_IS_NOT_FOUND')
  }

  return createAuthTokensForUser(
    {
      app_user_id: userAndRolesMappingObj[app_name]?.user_id,
      first_name: appUser?.first_name,
      last_name: appUser?.last_name,
      org_brand_id: params?.org_brand_id,
      org_id: params?.org_id,
      roles: userAndRolesMappingObj[app_name]?.roles,
      user_id: appUser?.id
    },
    transaction
  )
}

export const logoutAUser = async (
  params: { token: string; type: string } = {} as { token: string; type: string },
  transaction?: EntityManager
) => revokeAnAuthTokenForUser(params, transaction)

export const logoutAUserByAdmin = async (
  params: { user_id: string } = {} as { user_id: string },
  transaction?: EntityManager
) => revokeAuthTokensForUser(params, transaction)

export const verifyTokenForUser = async (
  params: { token: string; type: string } = {} as { token: string; type: string },
  transaction?: EntityManager
) => verifyAnAuthTokenForUser(params, transaction)

export const refreshTokensForUser = async (
  params: { custom_claims: Record<string, unknown>; refresh_token: string } = {} as {
    custom_claims: Record<string, unknown>
    refresh_token: string
  },
  transaction?: EntityManager
) => refreshAuthTokensForUser(params, transaction)

export interface ChangeEmailParams {
  email: string
  new_email: string
}

export const changeEmailByUser = async (
  params: ChangeEmailParams = {} as ChangeEmailParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'email', required: true, type: 'string' },
      { field: 'new_email', required: true, type: 'string' }
    ],
    params
  )

  const { email, new_email } = params || {}

  const existingUser = await getAUser([{ email: new_email }, { new_email }], transaction)
  if (existingUser?.id) {
    throw new Error('NEW_EMAIL_IS_ALREADY_ASSOCIATED_WITH_A_USER')
  }

  const user = await getAUser({ email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'active')) {
    throw new Error(`USER_IS_${user?.status?.toUpperCase()}`)
  }
  if (user?.has_temp_password) {
    return { message: 'NEW_PASSWORD_REQUIRED', success: false }
  }

  await getRepository('user', transaction).update(user.id, { new_email })

  await deleteVerificationTokens(
    {
      email: new_email,
      status: 'unverified',
      type: In([...VERIFICATION_TYPES]),
      user_id: user?.id
    },
    transaction
  )

  await createAVerificationTokenAndSendNotification(
    { ...sanitizeUser(user), email: new_email, type: 'user_verification', user_id: user?.id },
    transaction
  )

  return { ...sanitizeUser(user), new_email }
}

export const cancelChangeEmailByUser = async (
  params: { email: string } = {} as { email: string },
  transaction?: EntityManager
) => {
  validateProps([{ field: 'email', required: true, type: 'string' }], params)

  const { email } = params || {}

  const user = await getAUser({ new_email: email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'active')) {
    throw new Error(`USER_IS_${user?.status?.toUpperCase()}`)
  }
  if (user?.has_temp_password) {
    return { message: 'NEW_PASSWORD_REQUIRED', success: false }
  }

  await getRepository('user', transaction).update(user.id, { new_email: null })

  const deletedTokens = await deleteVerificationTokens(
    {
      email,
      status: 'unverified',
      type: In([...VERIFICATION_TYPES]),
      user_id: user?.id
    },
    transaction
  )
  if (deletedTokens?.affected === undefined || deletedTokens?.affected <= 0) {
    throw new Error('NO_CHANGE_EMAIL_REQUEST_IS_FOUND')
  }

  return { ...sanitizeUser(user), new_email: null }
}

export interface VerifyChangeEmailParams {
  token: string
  user_id: string
}

export const verifyChangeEmailByUser = async (
  params: VerifyChangeEmailParams = {} as VerifyChangeEmailParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'token', required: true, type: 'string' },
      { field: 'user_id', required: true, type: 'string' }
    ],
    params
  )

  const { token, user_id } = params || {}
  const verificationToken = await readAVerificationToken(
    {
      status: 'unverified',
      type: In([...VERIFICATION_TYPES]),
      token,
      user_id
    },
    transaction
  )
  if (!verificationToken?.id) {
    throw new Error('OTP_IS_NOT_VALID')
  }
  if (new Date(verificationToken?.expired_at).getTime() < Date.now()) {
    throw new Error('OTP_IS_EXPIRED')
  }

  await deleteAVerificationToken({ id: verificationToken.id }, transaction)

  const user = await getAUser({ id: user_id }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'active')) {
    throw new Error(`USER_IS_${user?.status?.toUpperCase()}`)
  }
  if (user?.has_temp_password) {
    return { message: 'NEW_PASSWORD_REQUIRED', success: false }
  }

  await getRepository('user', transaction).update(user.id, { email: user?.new_email, new_email: null })

  return { ...sanitizeUser(user), email: user?.new_email, new_email: null }
}

export const changeEmailByAdmin = async (
  params: ChangeEmailParams = {} as ChangeEmailParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'email', required: true, type: 'string' },
      { field: 'new_email', required: true, type: 'string' }
    ],
    params
  )

  const { email, new_email } = params || {}

  const existingUser = await getAUser([{ email: new_email }, { new_email }], transaction)
  if (existingUser?.id) {
    throw new Error('NEW_EMAIL_IS_ALREADY_ASSOCIATED_WITH_A_USER')
  }

  const user = await getAUser({ email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }

  await getRepository('user', transaction).update(user.id, { email: new_email, new_email: null })

  return { ...sanitizeUser(user), email: new_email, new_email: null }
}

export interface ChangePasswordByUserParams {
  new_password: string
  old_password: string
  user_id: string
}

export const changePasswordByUser = async (
  params: ChangePasswordByUserParams = {} as ChangePasswordByUserParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'new_password', required: true, type: 'string' },
      { field: 'old_password', required: true, type: 'string' },
      { field: 'user_id', required: true, type: 'string' }
    ],
    params
  )

  const { new_password, old_password, user_id } = params || {}

  if (new_password === old_password) {
    throw new Error('NEW_PASSWORD_IS_SAME_AS_OLD_PASSWORD')
  }

  const user = await getAUser({ id: user_id }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'active')) {
    throw new Error(`USER_IS_${user?.status?.toUpperCase()}`)
  }
  if (!checkPasswordPolicy(new_password)) {
    throw new Error('PASSWORD_DID_NOT_CONFORM_OUR_POLICY')
  }
  if (!compareHashPassword(old_password, user?.password)) {
    throw new Error('OLD_PASSWORD_IS_INCORRECT')
  }
  if (checkOldPasswords(new_password, user?.old_passwords)) {
    throw new Error('PASSWORD_IS_ALREADY_USED_BEFORE')
  }

  const hashPassword = generateHashPassword(new_password)

  const updatingData: Partial<UserModel> = { password: hashPassword }
  if (user?.has_temp_password) {
    updatingData.has_temp_password = false
  } else {
    updatingData.old_passwords = [...(user.old_passwords || []).slice(1, 3), hashPassword]
  }

  await getRepository('user', transaction).update(user.id, updatingData)

  await deleteAuthTokensForUser({ user_id }, transaction)

  return { ...sanitizeUser(user), ...updatingData }
}

export interface ChangePasswordByAdminParams {
  email: string
  password: string
}

export const changePasswordByAdmin = async (
  params: ChangePasswordByAdminParams = {} as ChangePasswordByAdminParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'email', required: true, type: 'string' },
      { field: 'password', required: true, type: 'string' }
    ],
    params
  )

  const { email, password } = params || {}

  const user = await getAUser({ email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }

  const hashPassword = generateHashPassword(password)
  const old_passwords = [...(user?.old_passwords || []).slice(1, 3), hashPassword]

  await getRepository('user', transaction).update(user.id, {
    has_temp_password: false,
    old_passwords,
    password: hashPassword
  })

  await deleteAuthTokensForUser({ user_id: user?.id }, transaction)

  return { ...sanitizeUser(user), has_temp_password: false }
}

export interface ForgotPasswordParams {
  email: string
  wrapper_html?: string
  variables?: Record<string, unknown>
}

export const forgotPassword = async (
  params: ForgotPasswordParams = {} as ForgotPasswordParams,
  transaction?: EntityManager
) => {
  validateProps([{ field: 'email', required: true, type: 'string' }], params)

  const { email } = params || {}

  const user = await getAUser({ email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }

  const existingTokens = await readVerificationTokens(
    {
      order: { created_at: 'DESC' },
      where: {
        created_at: MoreThanOrEqual(new Date(Date.now() - 10 * 60 * 1000)),
        email,
        status: In(['cancelled', 'unverified']),
        type: 'forgot_password',
        user_id: user?.id
      }
    },
    transaction
  )
  if (existingTokens?.length >= 3) {
    throw new Error('TOO_MANY_FORGOT_PASSWORD_REQUESTS')
  }

  await updateVerificationTokens(
    {
      data: { status: 'cancelled' },
      options: { where: { email, status: 'unverified', type: 'forgot_password', user_id: user?.id } }
    },
    transaction
  )
  await createAVerificationTokenAndSendNotification(
    { ...sanitizeUser(user), type: 'forgot_password', user_id: user?.id },
    transaction
  )

  return sanitizeUser(user)
}

export const retryForgotPassword = async (
  params: ForgotPasswordParams = {} as ForgotPasswordParams,
  transaction?: EntityManager
) => {
  validateProps([{ field: 'email', required: true, type: 'string' }], params)

  const { email } = params || {}

  const user = await getAUser({ email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }

  const existingTokens = await readVerificationTokens(
    {
      order: { created_at: 'DESC' },
      where: {
        created_at: MoreThanOrEqual(new Date(Date.now() - 10 * 60 * 1000)),
        email,
        status: In(['cancelled', 'unverified']),
        type: In([...FORGOT_PASSWORD_TYPES]),
        user_id: user?.id
      }
    },
    transaction
  )
  if (existingTokens?.length >= 3) {
    throw new Error('TOO_MANY_FORGOT_PASSWORD_REQUESTS')
  }

  await updateVerificationTokens(
    {
      data: { status: 'cancelled' },
      options: {
        where: {
          email,
          status: 'unverified',
          type: In([...FORGOT_PASSWORD_TYPES]),
          user_id: user?.id
        }
      }
    },
    transaction
  )
  await createAVerificationTokenAndSendNotification(
    { ...sanitizeUser(user), type: 'resend_forgot_password', user_id: user?.id },
    transaction
  )

  return sanitizeUser(user)
}

export interface VerifyForgotPasswordCodeParams {
  email: string
  token: string
}

export const verifyForgotPasswordCode = async (
  params: VerifyForgotPasswordCodeParams = {} as VerifyForgotPasswordCodeParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'email', required: true, type: 'string' },
      { field: 'token', required: true, type: 'string' }
    ],
    params
  )

  const { email, token } = params || {}
  const verificationToken = await readAVerificationToken(
    {
      email,
      status: 'unverified',
      token,
      type: In([...FORGOT_PASSWORD_TYPES])
    },
    transaction
  )
  if (!verificationToken?.id) {
    throw new Error('OTP_IS_NOT_VALID')
  }
  if (new Date(verificationToken?.expired_at).getTime() < Date.now()) {
    throw new Error('OTP_IS_EXPIRED')
  }

  return { message: 'OTP_IS_VALID', success: true }
}

export interface VerifyForgotPasswordParams {
  email: string
  password: string
  token: string
}

export const verifyForgotPassword = async (
  params: VerifyForgotPasswordParams = {} as VerifyForgotPasswordParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'email', required: true, type: 'string' },
      { field: 'password', required: true, type: 'string' },
      { field: 'token', required: true, type: 'string' }
    ],
    params
  )

  const { email, password, token } = params || {}
  const verificationToken = await readAVerificationToken(
    {
      email,
      status: 'unverified',
      token,
      type: In([...FORGOT_PASSWORD_TYPES])
    },
    transaction
  )
  if (!verificationToken?.id) {
    throw new Error('OTP_IS_NOT_VALID')
  }
  if (new Date(verificationToken?.expired_at).getTime() < Date.now()) {
    throw new Error('OTP_IS_EXPIRED')
  }

  const user = await getAUser({ email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!checkPasswordPolicy(password)) {
    throw new Error('PASSWORD_DID_NOT_CONFORM_OUR_POLICY')
  }
  if (compareHashPassword(password, user?.password)) {
    throw new Error('PASSWORD_IS_ALREADY_USED_BEFORE')
  }
  if (checkOldPasswords(password, user?.old_passwords)) {
    throw new Error('PASSWORD_IS_ALREADY_USED_BEFORE')
  }

  const hashPassword = generateHashPassword(password)
  const old_passwords = [...(user?.old_passwords || []).slice(1, 3), hashPassword]

  await getRepository('user', transaction).update(user.id, {
    has_temp_password: false,
    old_passwords,
    password: hashPassword
  })

  await deleteVerificationTokens({ email, type: In([...FORGOT_PASSWORD_TYPES]), user_id: user?.id }, transaction)
  await deleteAuthTokensForUser({ user_id: user?.id }, transaction)

  return { ...sanitizeUser(user), has_temp_password: false }
}

export interface VerifyUserPasswordParams {
  email: string
  password: string
}

export const verifyUserPassword = async (
  params: VerifyUserPasswordParams = {} as VerifyUserPasswordParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'email', required: true, type: 'string' },
      { field: 'password', required: true, type: 'string' }
    ],
    params
  )

  const { email, password } = params || {}

  const user = await getAUser({ email }, transaction)
  if (!user?.id) {
    throw new Error('USER_IS_NOT_FOUND')
  }
  if (!(user?.status === 'active')) {
    throw new Error(`USER_IS_${user?.status?.toUpperCase()}`)
  }
  if (!compareHashPassword(password, user?.password)) {
    return { message: 'PASSWORD_IS_INCORRECT', success: false }
  }

  return { message: 'PASSWORD_IS_CORRECT', success: true }
}
