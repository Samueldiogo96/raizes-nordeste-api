import { randomBytes } from 'node:crypto';
import { FinalidadeConsentimento, Perfil, PERFIS_FUNCIONARIO, VERSAO_TERMO_ATUAL } from '../../domain/enums';
import { Erros } from '../../domain/errors';
import { prisma } from '../../infrastructure/database/prisma';
import { mascararEmail, mascararTelefone, senhas } from '../../infrastructure/security/security';
import { AuditLogger, Contexto } from '../ports';

/**
 * Usuários e LGPD: dados próprios, exportação, consentimentos,
 * anonimização e consulta mascarada por funcionários.
 */
export class UsuarioService {
  constructor(private readonly audit: AuditLogger) {}

  async criarFuncionario(
    ctx: Contexto,
    input: { nome: string; email: string; senha: string; perfil: Perfil; unidadeId?: number },
  ) {
    const { ator } = ctx;
    if (ator.perfil === 'GERENTE') {
      if (!['ATENDENTE', 'COZINHA'].includes(input.perfil))
        throw Erros.semPermissao('Gerentes só podem cadastrar atendentes e cozinha.');
      if (input.unidadeId !== undefined && input.unidadeId !== ator.unidadeId)
        throw Erros.semPermissao('Gerentes só cadastram funcionários da própria unidade.');
      input.unidadeId = ator.unidadeId ?? undefined;
    }
    if (input.perfil === 'CLIENTE')
      throw Erros.validacao('Clientes se cadastram por POST /auth/registrar.', [{ field: 'perfil', issue: 'Use um perfil de funcionário' }]);
    if (PERFIS_FUNCIONARIO.includes(input.perfil) && !input.unidadeId)
      throw Erros.validacao('Funcionários precisam de uma unidade.', [{ field: 'unidadeId', issue: 'Obrigatório para este perfil' }]);
    if (input.unidadeId) {
      const un = await prisma.unidade.findUnique({ where: { id: input.unidadeId } });
      if (!un) throw Erros.naoEncontrado('Unidade', [{ field: 'unidadeId', issue: `Unidade ${input.unidadeId} não existe` }]);
    }
    const email = input.email.toLowerCase().trim();
    if (await prisma.usuario.findUnique({ where: { email } }))
      throw Erros.conflito('EMAIL_JA_CADASTRADO', 'Já existe uma conta com este e-mail.', [{ field: 'email', issue: 'E-mail já cadastrado' }]);

    const u = await prisma.usuario.create({
      data: {
        nome: input.nome,
        email,
        senhaHash: await senhas.hash(input.senha),
        perfil: input.perfil,
        unidadeId: input.perfil === 'ADMIN' ? null : input.unidadeId,
      },
    });
    await this.audit.registrar(ctx, { acao: 'FUNCIONARIO_CADASTRADO', entidade: 'Usuario', entidadeId: u.id, detalhes: { perfil: u.perfil, unidadeId: u.unidadeId } });
    return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, unidadeId: u.unidadeId, criadoEm: u.criadoEm };
  }

  /** Dados do próprio usuário, sem o hash da senha. */
  async meusDados(ctx: Contexto) {
    const u = await prisma.usuario.findUnique({
      where: { id: ctx.ator.id },
      include: { consentimentos: { orderBy: { registradoEm: 'desc' } }, contaFidelidade: true },
    });
    if (!u) throw Erros.naoEncontrado('Usuario');
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      telefone: u.telefone,
      dataNascimento: u.dataNascimento,
      perfil: u.perfil,
      unidadeId: u.unidadeId,
      consentimentos: this.consentimentosVigentes(u.consentimentos),
      saldoPontos: u.contaFidelidade?.saldoPontos ?? null,
      criadoEm: u.criadoEm,
    };
  }

  /** Exporta todos os dados guardados sobre o usuário (portabilidade). */
  async exportarMeusDados(ctx: Contexto) {
    const dados = await prisma.usuario.findUnique({
      where: { id: ctx.ator.id },
      select: {
        id: true, nome: true, email: true, telefone: true, dataNascimento: true, perfil: true, criadoEm: true,
        consentimentos: true,
        contaFidelidade: { include: { transacoes: true } },
        pedidos: { include: { itens: true }, orderBy: { criadoEm: 'desc' } },
      },
    });
    await this.audit.registrar(ctx, { acao: 'DADOS_EXPORTADOS_TITULAR', entidade: 'Usuario', entidadeId: ctx.ator.id });
    return { geradoEm: new Date().toISOString(), titular: dados };
  }

  async registrarConsentimento(ctx: Contexto, finalidade: FinalidadeConsentimento, concedido: boolean, canal?: string) {
    const usuarioId = ctx.ator.id;
    await prisma.$transaction(async (tx) => {
      // Revoga o consentimento atual e mantém o histórico.
      await tx.consentimento.updateMany({
        where: { usuarioId, finalidade, revogadoEm: null },
        data: { revogadoEm: new Date() },
      });
      await tx.consentimento.create({
        data: { usuarioId, finalidade, concedido, versaoTermo: VERSAO_TERMO_ATUAL, canal: canal ?? null },
      });
      if (finalidade === 'FIDELIDADE' && concedido) {
        await tx.contaFidelidade.upsert({ where: { usuarioId }, create: { usuarioId }, update: {} });
      }
      if (finalidade === 'MARKETING' && !concedido) {
        // Sem marketing, a data de nascimento deixa de ser necessária.
        await tx.usuario.update({ where: { id: usuarioId }, data: { dataNascimento: null } });
      }
      await this.audit.registrar(ctx, { acao: concedido ? 'CONSENTIMENTO_CONCEDIDO' : 'CONSENTIMENTO_REVOGADO', entidade: 'Usuario', entidadeId: usuarioId, detalhes: { finalidade, versaoTermo: VERSAO_TERMO_ATUAL } }, tx);
    });
    return this.meusDados(ctx);
  }

  /**
   * Anonimiza os dados pessoais em vez de apagar, porque os pedidos
   * precisam ser guardados por obrigação fiscal.
   */
  async anonimizarMinhaConta(ctx: Contexto) {
    const id = ctx.ator.id;
    if (ctx.ator.perfil !== 'CLIENTE') throw Erros.semPermissao('Contas de funcionários são encerradas pelo administrador.');
    await prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id },
        data: {
          nome: 'Titular anonimizado',
          email: `anonimizado+${id}.${randomBytes(4).toString('hex')}@anonimizado.local`,
          telefone: null,
          dataNascimento: null,
          senhaHash: await senhas.hash(randomBytes(24).toString('hex')),
          ativo: false,
          anonimizadoEm: new Date(),
        },
      });
      await tx.consentimento.updateMany({ where: { usuarioId: id, revogadoEm: null }, data: { revogadoEm: new Date() } });
      await this.audit.registrar(ctx, { acao: 'CONTA_ANONIMIZADA', entidade: 'Usuario', entidadeId: id }, tx);
    });
  }

  /** Funcionário consulta cliente: dados mascarados e acesso registrado na auditoria. */
  async buscarPorId(ctx: Contexto, id: number) {
    const u = await prisma.usuario.findUnique({ where: { id }, include: { consentimentos: true, contaFidelidade: true } });
    if (!u) throw Erros.naoEncontrado('Usuario');
    await this.audit.registrar(ctx, { acao: 'ACESSO_DADOS_PESSOAIS', entidade: 'Usuario', entidadeId: id, detalhes: { motivo: 'consulta_atendimento' } });
    return {
      id: u.id,
      nome: u.nome,
      email: mascararEmail(u.email),
      telefone: mascararTelefone(u.telefone),
      perfil: u.perfil,
      ativo: u.ativo,
      consentimentos: this.consentimentosVigentes(u.consentimentos),
      saldoPontos: u.contaFidelidade?.saldoPontos ?? null,
    };
  }

  private consentimentosVigentes(lista: { finalidade: string; concedido: boolean; revogadoEm: Date | null; versaoTermo: string; registradoEm: Date }[]) {
    const vigentes: Record<string, { concedido: boolean; versaoTermo: string; registradoEm: Date }> = {};
    for (const c of lista.filter((c) => !c.revogadoEm)) {
      vigentes[c.finalidade] = { concedido: c.concedido, versaoTermo: c.versaoTermo, registradoEm: c.registradoEm };
    }
    return vigentes;
  }
}

/** Verifica se o cliente tem consentimento vigente para a finalidade. */
export async function temConsentimento(db: { consentimento: typeof prisma.consentimento }, usuarioId: number, finalidade: FinalidadeConsentimento) {
  const c = await db.consentimento.findFirst({
    where: { usuarioId, finalidade, revogadoEm: null },
    orderBy: { registradoEm: 'desc' },
  });
  return !!c?.concedido;
}
