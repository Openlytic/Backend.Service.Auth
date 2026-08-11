import { EntityManager } from 'typeorm'

import { getAppURL, getRandomNumber } from './common.service'
import { sendNotification } from './notification.service'
import { getRepository, VerificationTokenModel } from './repository'

export const getVerificationTokenTypes = (): string[] => [
  'forgot_password',
  'resend_forgot_password',
  'resend_user_verification',
  'user_verification'
]

export const createAVerificationToken = async (data: Partial<VerificationTokenModel>, transaction?: EntityManager) => {
  const repository = getRepository('verification_token', transaction)
  return (await repository.save(repository.create(data))) as VerificationTokenModel
}

export const readAVerificationToken = async (options: Record<string, unknown>, transaction?: EntityManager) =>
  (await getRepository('verification_token', transaction).findOne({ where: options })) as VerificationTokenModel | null

export const readVerificationTokens = async (options: Record<string, unknown>, transaction?: EntityManager) =>
  (await getRepository('verification_token', transaction).find({ ...options })) as VerificationTokenModel[]

export const updateAVerificationToken = async (
  params: { data: Partial<VerificationTokenModel>; options: Record<string, unknown> },
  transaction?: EntityManager
) => {
  const { data, options } = params || {}
  const verificationToken = await readAVerificationToken(options, transaction)
  if (!verificationToken?.id) {
    throw new Error('VERIFICATION_TOKEN_IS_NOT_FOUND')
  }

  await getRepository('verification_token', transaction).update(
    verificationToken.id,
    data as Partial<VerificationTokenModel>
  )

  return { ...verificationToken, ...data }
}

export const updateVerificationTokens = async (
  params: { data: Partial<VerificationTokenModel>; options: { where: Record<string, unknown> } },
  transaction?: EntityManager
) =>
  getRepository('verification_token', transaction).update(
    params?.options?.where,
    params?.data as Partial<VerificationTokenModel>
  )

export const deleteAVerificationToken = async (options: Record<string, unknown>, transaction?: EntityManager) => {
  const verificationToken = await readAVerificationToken(options, transaction)
  if (!verificationToken?.id) {
    throw new Error('VERIFICATION_TOKEN_IS_NOT_FOUND')
  }

  await getRepository('verification_token', transaction).delete(verificationToken.id)

  return verificationToken
}

export const deleteVerificationTokens = async (options: Record<string, unknown>, transaction?: EntityManager) =>
  getRepository('verification_token', transaction).delete(options)

export interface CreateVerificationTokenAndSendNotificationParams {
  contact_id?: string | null
  contact_person_id?: string | null
  email?: string
  first_name?: string | null
  last_name?: string | null
  org_id?: string | null
  type?: string
  user_id?: string | null
  wrapper_html?: string
  variables?: Record<string, unknown>
  [key: string]: unknown
}

export const createAVerificationTokenAndSendNotification = async (
  params: CreateVerificationTokenAndSendNotificationParams = {},
  transaction?: EntityManager
) => {
  const types = getVerificationTokenTypes()
  if (
    !(params?.contact_id || params?.contact_person_id || params?.user_id) &&
    params?.type &&
    !types.includes(params?.type)
  ) {
    return false
  }

  const verificationToken = await createAVerificationToken(
    {
      email: params?.email,
      token: getRandomNumber(6),
      type: params?.type || 'user_verification',
      user_id: params?.user_id || null
    },
    transaction
  )
  if (!verificationToken?.id) {
    throw new Error('COULD_NOT_SEND_VERIFICATION_TOKEN')
  }

  const eventMappingObject: Record<string, string> = {
    forgot_password: 'send_forgot_password_token',
    resend_forgot_password: 'send_forgot_password_token',
    resend_user_verification: 'resend_user_verification_token',
    user_verification: 'send_user_verification_token',
    send_contact_verification: 'send_contact_auth_token_for_offer'
  }

  await sendNotification({
    event: eventMappingObject[params?.type || 'user_verification'],
    org_id: params?.org_id,
    to_email: params?.email,
    wrapper_html: params?.wrapper_html,
    variables: {
      ...(params?.variables || {}),
      email: params?.email,
      token: verificationToken?.token,
      url: getAppURL(),
      username:
        params?.first_name || params?.last_name ? [params?.first_name || '', params?.last_name || ''].join(' ') : ''
    }
  })

  return verificationToken
}
