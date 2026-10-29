import { randomUUID } from 'node:crypto';

/** Repository doubles for transport E2E only; PostgreSQL uses the same checks separately. */
export function boardEventsMemorySource() {
  const tables = new Map();
  const repositories = new Map();
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) =>
      (key === 'id' || key.endsWith('Id')) &&
      typeof value === 'string' &&
      typeof row[key] === 'string'
        ? row[key].toLowerCase() === value.toLowerCase()
        : row[key] === value,
    );
  const source = {
    options: { type: 'postgres' },
    entityMetadatas: [],
    isInitialized: false,
    getRepository(entity) {
      const name = typeof entity === 'string' ? entity : entity.name;
      if (repositories.has(name)) return repositories.get(name);
      const rows = new Map();
      tables.set(name, rows);
      const repository = {
        manager: source.manager,
        create(input) {
          return { ...input };
        },
        async save(input) {
          if (Array.isArray(input))
            return Promise.all(input.map((row) => this.save(row)));
          const value = {
            createdAt: new Date(),
            updatedAt: new Date(),
            joinedAt: new Date(),
            ...input,
            id: input.id ?? randomUUID(),
          };
          rows.set(value.id, globalThis.structuredClone(value));
          return value;
        },
        async find({ where, order } = {}) {
          const result = [...rows.values()]
            .filter((row) => matches(row, where))
            .map((row) => globalThis.structuredClone(row));
          if (order)
            result.sort((a, b) => {
              for (const [key, direction] of Object.entries(order)) {
                const comparison =
                  key === 'position'
                    ? Number(a[key]) - Number(b[key])
                    : String(a[key]).localeCompare(String(b[key]));
                if (comparison)
                  return direction === 'DESC' ? -comparison : comparison;
              }
              return 0;
            });
          return result;
        },
        async findOne(options) {
          const row = (await this.find(options))[0];
          if (!row) return null;
          if (name === 'BoardMember') {
            if (options.relations?.board)
              row.board = await source
                .getRepository('Board')
                .findOne({ where: { id: row.boardId } });
            if (options.relations?.user)
              row.user = await source
                .getRepository('User')
                .findOne({ where: { id: row.userId } });
          }
          if (name === 'Card' && options.relations?.assignees)
            row.assignees = await source
              .getRepository('CardAssignee')
              .find({ where: { cardId: row.id } });
          return row;
        },
        async count(options) {
          return (await this.find(options)).length;
        },
        async delete(where) {
          let affected = 0;
          for (const [id, row] of rows)
            if (matches(row, where)) {
              rows.delete(id);
              affected++;
            }
          return { affected };
        },
        async remove(row) {
          rows.delete(row.id);
          row.id = undefined;
        },
        async softRemove(row) {
          const value = { ...row, deletedAt: new Date() };
          rows.set(value.id, globalThis.structuredClone(value));
          return value;
        },
        createQueryBuilder() {
          const filters = {};
          return {
            delete() {
              return this;
            },
            from() {
              return this;
            },
            where(_sql, parameters) {
              Object.assign(filters, parameters);
              return this;
            },
            andWhere(_sql, parameters) {
              Object.assign(filters, parameters);
              return this;
            },
            // This legacy fixture has explicit PRIVATE memberships only.
            async getOne() {
              return null;
            },
            async execute() {
              let affected = 0;
              for (const [id, row] of rows) {
                const card = tables.get('Card')?.get(row.cardId);
                if (
                  row.userId === filters.userId &&
                  card?.boardId === filters.boardId
                ) {
                  rows.delete(id);
                  affected++;
                }
              }
              return { affected };
            },
          };
        },
      };
      repositories.set(name, repository);
      return repository;
    },
    manager: {
      async transaction(callback) {
        return callback(this);
      },
      getRepository(entity) {
        return source.getRepository(entity);
      },
    },
  };
  return source;
}
