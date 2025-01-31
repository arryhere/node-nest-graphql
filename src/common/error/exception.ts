import { GraphQLError } from 'graphql';

// use this only in catch block
export function Exception(error: any, message: string): void {
  if (error.name !== 'GraphQLError') throw new GraphQLError(message);
  if (error.extensions.code) throw new GraphQLError(error.message, { extensions: { code: error.extensions.code } });
  if (error.message) throw new GraphQLError(error.message);
}
