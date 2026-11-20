import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Perfil } from '../../domain/enums';
import { config } from '../config';

/** 10 rounds de bcrypt: lento contra força bruta, rápido no login. */
const BCRYPT_ROUNDS = 10;

export const senhas = {
  hash: (senha: string) => bcrypt.hash(senha, BCRYPT_ROUNDS),
  comparar: (senha: string, hash: string) => bcrypt.compare(senha, hash),
};

export interface TokenPayload {
  sub: number;
  perfil: Perfil;
  unidadeId: number | null;
}

export const tokens = {
  gerar(payload: TokenPayload): string {
    // O token leva só id, perfil e unidade, sem dados pessoais.
    return jwt.sign({ perfil: payload.perfil, unidadeId: payload.unidadeId }, config.jwtSecret, {
      subject: String(payload.sub),
      expiresIn: config.jwtExpiresIn,
      issuer: 'raizes-nordeste-api',
    });
  },
  verificar(token: string): TokenPayload {
    const dec = jwt.verify(token, config.jwtSecret, { issuer: 'raizes-nordeste-api' }) as jwt.JwtPayload;
    return { sub: Number(dec.sub), perfil: dec.perfil, unidadeId: dec.unidadeId ?? null };
  },
};

/** Mascara e-mail para exibição a funcionários: maria.silva@x.com → ma***@x.com */
export function mascararEmail(email: string): string {
  const [user, dominio] = email.split('@');
  if (!dominio) return '***';
  return `${user.slice(0, 2)}***@${dominio}`;
}

/** Mascara telefone: (81) 99999-1234 → *******1234 */
export function mascararTelefone(tel: string | null): string | null {
  if (!tel) return null;
  const dig = tel.replace(/\D/g, '');
  return `${'*'.repeat(Math.max(dig.length - 4, 0))}${dig.slice(-4)}`;
}
