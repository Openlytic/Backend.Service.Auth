import { EntityManager, Repository } from 'typeorm'

export type AuthEntityName = 'user' | 'auth_token' | 'verification_token'

export type AuthRepositoryAccessor = (name: AuthEntityName, transaction?: EntityManager) => Repository<unknown>

let repositoryAccessor: AuthRepositoryAccessor | null = null

export const configureRepositoryAccessor = (accessor: AuthRepositoryAccessor): void => {
  repositoryAccessor = accessor
}

export const getRepository = (name: AuthEntityName, transaction?: EntityManager): Repository<unknown> => {
  if (!repositoryAccessor) {
    throw new Error('REPOSITORY_ACCESSOR_IS_NOT_CONFIGURED')
  }
  return repositoryAccessor(name, transaction)
}

export interface UserModel {
  id: string
  email: string
  new_email: string | null
  password: string | null
  old_passwords: string[]
  status: string
  has_temp_password: boolean
  first_name: string | null
  last_name: string | null
}

export interface AuthTokenModel {
  id: string
  access_token: string
  refresh_token: string | null
  contact_id: string | null
  user_id: string | null
}

export interface VerificationTokenModel {
  id: string
  email: string
  token: string
  type: string
  status: string
  expired_at: Date
  user_id: string | null
}
