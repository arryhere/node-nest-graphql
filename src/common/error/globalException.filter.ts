import { ExceptionFilter, Catch } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { status } from 'http-status';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: any): void {
    throw new GraphQLError(exception?.message ?? status['500_NAME'], {
      extensions: { code: exception?.extensions?.code ?? status.INTERNAL_SERVER_ERROR },
    });
  }
}
