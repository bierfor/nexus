// Database client placeholder
// Replace with your preferred ORM (Prisma, Drizzle, etc.)

export const db = {
  user: {
    async findFirst() {
      return { id: 1, name: 'Demo User', email: 'demo@nexusjs.dev' };
    },
    async findMany() {
      return [{ id: 1, name: 'Demo User', email: 'demo@nexusjs.dev' }];
    },
    async update(args: { where?: unknown; data: unknown }) {
      return { ...(args.data as object) };
    },
    async create(args: { data: unknown }) {
      return args.data;
    },
  },
};
