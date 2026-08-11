export interface SendNotificationParams {
  event?: string
  from_email?: string
  org_id?: string | null
  to_email?: string
  variables?: Record<string, unknown>
  wrapper_html?: string
}

export const sendNotification = async (params: SendNotificationParams = {}) => {
  const { event, from_email, org_id, to_email, variables = {}, wrapper_html } = params || {}
  if (!(event && to_email)) {
    throw new Error('MISSING_REQUIRED_FIELDS_TO_SEND_NOTIFICATION')
  }

  console.log('[openlytic:auth:notification:stub]', JSON.stringify({ event, from_email, org_id, to_email, variables }))

  return { MessageId: `stubbed-${Date.now()}`, message: 'STUBBED_EMAIL_SENT', success: true }
}
