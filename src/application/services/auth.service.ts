import { VERSAO_TERMO_ATUAL } from '../../domain/enums';
import { AppError, Erros } from '../../domain/errors';
import { prisma } from '../../infrastructure/database/prisma';
import { logger } from '../../infrastructure/logger';
import { senhas, tokens } from '../../infrastructure/security/security';
import { config } from '../../infrastructure/config';
import { AuditLogger } from '../ports';

export interface RegistrarClienteInput {
  nome: string;
  email: string;
  senha: string;
  telefone?: string;
  dataNascimento?: string;
  consentimentoFidelidade: boolean;
  consentimentoMarketing: boolean;
  canal?: string;
}

export class AuthService {
  constructor(private readonly audit: AuditLogger) {}

  /** Cadastro de cliente com os consentimentos escolhidos. */
  async registrarCliente(input: RegistrarClienteInput) {
    const email = input.email.toLowerCase().trim();
    const existe = await prisma.usuario.findUnique({ where: { email } });
    if (existe) {
      throw Erros.conflito('EMAIL_JA_CADASTRADO', 'Já existe uma conta com este e-mail.', [
        { field: 'email', issue: 'E-mail já cadastrado' },
      ]);
    }

    const senhaHash = await senhas.hash(input.senha);

    const usuario = await prisma.$transaction(async (tx) => {
      const u = await tx.usuario.create({
        data: {
          nome: input.nome.trim(),
          email,
          senhaHash,
          perfil: 'CLIENTE',
          telefone: input.telefone ?? null,
          // Data de nascimento só serve para campanhas: exige consentimento de marketing.
          dataNascimento:
            input.consentimentoMarketing && input.dataNascimento ? new Date(input.dataNascimento) : null,
        },
      });
      await tx.consentimento.createMany({
        data: [
          { usuarioId: u.id, finalidade: 'FIDELIDADE', concedido: input.consentimentoFidelidade, versaoTermo: VERSAO_TERMO_ATUAL, canal: input.canal ?? null },
          { usuarioId: u.id, finalidade: 'MARKETING', concedido: input.consentimentoMarketing, versaoTermo: VERSAO_TERMO_ATUAL, canal: input.canal ?? null },
        ],
      });
      if (input.consentimentoFidelidade) {
        await tx.contaFidelidade.create({ data: { usuarioId: u.id } });
      }
      await this.audit.registrar(
        { ator: { id: u.id, perfil: 'CLIENTE', unidadeId: null } },
        {
          acao: 'USUARIO_CADASTRADO',
          entidade: 'Usuario',
          entidadeId: u.id,
          detalhes: { fidelidade: input.consentimentoFidelidade, marketing: input.consentimentoMarketing, versaoTermo: VERSAO_TERMO_ATUAL },
        },
        tx,
      );
      return u;
    });

    return {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      consentimentos: { FIDELIDADE: input.consentimentoFidelidade, MARKETING: input.consentimentoMarketing },
      criadoEm: usuario.criadoEm,
    };
  }

  async login(email: string, senha: string, ip?: string) {
    const usuario = await prisma.usuario.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Mesma mensagem nos dois casos para não revelar quais e-mails existem.
    const ok = usuario && usuario.ativo && (await senhas.comparar(senha, usuario.senhaHash));
    if (!usuario || !ok) {
      logger.warn('login_falhou', { ip, usuarioId: usuario?.id ?? null });
      throw Erros.credenciaisInvalidas();
    }
    if (usuario.perfil !== 'ADMIN' && usuario.perfil !== 'CLIENTE' && !usuario.unidadeId) {
      throw new AppError(409, 'FUNCIONARIO_SEM_UNIDADE', 'Funcionário sem unidade vinculada. Contate o administrador.');
    }

    const accessToken = tokens.gerar({ sub: usuario.id, perfil: usuario.perfil as never, unidadeId: usuario.unidadeId });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: config.jwtExpiresIn,
      user: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil, unidadeId: usuario.unidadeId },
    };
  }
}
