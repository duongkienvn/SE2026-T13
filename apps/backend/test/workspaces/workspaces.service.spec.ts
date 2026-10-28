import { EntityManager, Repository } from 'typeorm';
import { Workspace } from '../../src/api/workspaces/entities/workspace.entity';
import { WorkspacesService } from '../../src/api/workspaces/workspaces.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('WorkspacesService transaction contract', () => {
  const workspace = { id: 'personal-id' };
  const repository = { findOneBy: jest.fn(), findOneByOrFail: jest.fn() };
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: jest.fn(),
    getRepository: jest.fn(),
  };
  const transaction = jest.fn();
  const service = new WorkspacesService({
    manager: { transaction },
  } as unknown as Repository<Workspace>);

  beforeEach(() => {
    jest.resetAllMocks();
    manager.queryRunner.isTransactionActive = true;
    manager.query.mockResolvedValue([{ id: workspace.id }]);
    manager.getRepository.mockReturnValue(repository);
    repository.findOneByOrFail.mockResolvedValue(workspace);
    transaction.mockImplementation((work) => work(manager));
  });

  it('uses a single owned transaction for standalone provisioning', async () => {
    expect(await service.ensurePersonalWorkspace('trusted-user')).toBe(
      workspace,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT public.ensure_personal_workspace($1::uuid) AS id',
      ['trusted-user'],
    );
  });

  it('uses the supplied transaction without nesting and propagates failure', async () => {
    const failure = new Error('transaction failure');
    manager.query.mockRejectedValue(failure);
    await expect(
      service.ensurePersonalWorkspace(
        'trusted-user',
        manager as unknown as EntityManager,
      ),
    ).rejects.toBe(failure);
    expect(transaction).not.toHaveBeenCalled();
    expect(repository.findOneByOrFail).not.toHaveBeenCalled();
  });

  it('rejects a nontransactional supplied manager before any writes', async () => {
    manager.queryRunner.isTransactionActive = false;
    await expect(
      service.ensurePersonalWorkspace(
        'trusted-user',
        manager as unknown as EntityManager,
      ),
    ).rejects.toThrow('active transaction');
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('looks up Personal ownership without consulting Board memberships', async () => {
    repository.findOneBy.mockResolvedValue(null);
    expect(
      await service.findPersonalWorkspace(
        'trusted-user',
        manager as unknown as EntityManager,
      ),
    ).toBeNull();
    expect(repository.findOneBy).toHaveBeenCalledWith({
      type: 'PERSONAL',
      createdById: 'trusted-user',
    });
    expect(manager.query).not.toHaveBeenCalled();
  });
});
