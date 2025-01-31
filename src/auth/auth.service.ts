import { HttpStatus, Injectable } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { JwtService } from '@nestjs/jwt';
import bcryptjs from 'bcryptjs';
import { TokenType } from '@prisma/client';
import { differenceInMinutes } from 'date-fns';

import { ForgotPasswordInput } from './dto/forgetPassword.input';
import { VerifyInput } from './dto/verify.input';
import { VerifyLinkInput } from './dto/verifyLink.input';
import { SignInInput } from './dto/signIn.input';
import { SignInOutput } from './dto/signIn.output';
import { RefreshTokenOutput } from './dto/refreshToken.output';
import { ResetPasswordInput } from './dto/resetPassword.input';
import { RefreshTokenInput } from './dto/refreshToken.input';
import { SignInMFAInput } from './dto/signInMFA.input';
import { SignUpInput } from './dto/signUp.input';
import { DEFAULT_PRIVILEGE } from '../privilege/constants/default.privilege';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { config } from '../config/config';
import { Exception } from '../common/error/exception';
import { IJwtPayload } from '../common/interface/jwtPayload.interface';
import { AppResponse } from '../common/dto/response.output';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService
  ) {}

  async auth(): Promise<string> {
    return 'auth';
  }

  async signUp(signUpInput: SignUpInput): Promise<AppResponse> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: signUpInput.email },
      });

      if (user) {
        throw new GraphQLError('Email already in use, contact support');
      }

      const verifyToken = this.jwtService.sign(
        { email: signUpInput.email },
        { expiresIn: '10m', secret: config.jwt.verify_token_secret }
      );

      await this.mailService.send_email('User Verification Link', `token: ${verifyToken}`, signUpInput.email);

      await this.prisma.token.create({
        data: {
          token: verifyToken,
          tokenType: TokenType.VERIFY_TOKEN,
          email: signUpInput.email,
        },
      });

      const passwordHash = await bcryptjs.hash(signUpInput.password, config.auth.passwordHashSalt);

      await this.prisma.user.create({
        data: {
          firstName: signUpInput.firstName,
          lastName: signUpInput.lastName,
          email: signUpInput.email,
          dob: signUpInput.dob,
          phoneNumber: signUpInput.phoneNumber,
          passwordHash: passwordHash,
          privileges: {
            connect: DEFAULT_PRIVILEGE.USER.map((e) => ({ name: e })),
          },
        },
      });

      return { success: true, message: 'SignUp success, proceed to verification' };
    } catch (error) {
      Exception(error, 'SignUp failed');
    }
  }

  async verifyLink(verifyLinkInput: VerifyLinkInput): Promise<AppResponse> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: verifyLinkInput.email },
      });

      if (!user) {
        throw new GraphQLError('Invalid User');
      }

      const passwordCompare = await bcryptjs.compare(verifyLinkInput.password, user.passwordHash);

      if (!passwordCompare) {
        throw new GraphQLError('Invalid Credentials');
      }

      const verifyToken = this.jwtService.sign(
        { email: verifyLinkInput.email },
        { expiresIn: `${config.auth.verifyTokenExpiryTime}m`, secret: config.jwt.verify_token_secret }
      );

      await this.mailService.send_email('User Verification Link', `token: ${verifyToken}`, verifyLinkInput.email);

      await this.prisma.token.create({
        data: {
          token: verifyToken,
          tokenType: TokenType.VERIFY_TOKEN,
          email: verifyLinkInput.email,
        },
      });

      return { success: true, message: 'Verification link sent, proceed to verification' };
    } catch (error) {
      Exception(error, 'Failed to send verification mail');
    }
  }

  async verify(verifyInput: VerifyInput): Promise<AppResponse> {
    try {
      const decoded: IJwtPayload = this.jwtService.verify(verifyInput.token, {
        secret: config.jwt.verify_token_secret,
      });

      const email = decoded.email;

      const verifyToken = await this.prisma.token.findUnique({
        where: { email_token: { email: email, token: verifyInput.token } },
      });

      if (!verifyToken) {
        throw new GraphQLError('Invalid Token');
      }

      if (differenceInMinutes(new Date(), verifyToken.createdAt) > config.auth.verifyTokenExpiryTime) {
        throw new GraphQLError('Token Expired');
      }

      await this.prisma.user.update({
        where: { email: email },
        data: { verified: true },
      });

      await this.prisma.token.delete({
        where: { email_token: { email: email, token: verifyInput.token } },
      });

      return { success: true, message: 'User verification success' };
    } catch (error) {
      Exception(error, 'User verification failed');
    }
  }

  async signIn(signInInput: SignInInput): Promise<SignInOutput> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: signInInput.email },
      });

      if (!user) {
        throw new GraphQLError('Invalid User');
      }

      if (!user.active) {
        throw new GraphQLError('Inactive User');
      }

      if (!user.verified) {
        try {
          const verifyToken = this.jwtService.sign(
            { email: signInInput.email },
            { expiresIn: `${config.auth.verifyTokenExpiryTime}m`, secret: config.jwt.verify_token_secret }
          );

          await this.mailService.send_email('User Verification Link', `token: ${verifyToken}`, signInInput.email);

          return {
            success: false,
            message: 'User not verified, verification link sent',
            proceedToMFA: false,
            redirectToSignIn: false,
            accessToken: '',
            refreshToken: '',
          };
        } catch {
          throw new GraphQLError('User not verified, failed to send verification link');
        }
      }

      if (user.accountLockedAt) {
        const accountLockedDelta = differenceInMinutes(new Date(), user.accountLockedAt);

        if (accountLockedDelta < config.auth.accountLockedTimeInMins) {
          return {
            success: false,
            message: `Account locked temporarily, try after ${config.auth.accountLockedTimeInMins - accountLockedDelta}mins`,
            proceedToMFA: false,
            redirectToSignIn: false,
            accessToken: '',
            refreshToken: '',
          };
        }
      }

      const passwordCompare = await bcryptjs.compare(signInInput.password, user.passwordHash);

      if (!passwordCompare) {
        throw new GraphQLError('Invalid Credentials', { extensions: { code: HttpStatus.BAD_REQUEST } });
      }

      if (user.mfa) {
        const mfaCode = String(Math.floor(100000 + Math.random() * 900000));

        await this.mailService.send_email('MFA Login Code', `MFA Code: ${mfaCode}`, signInInput.email);

        await this.prisma.token.create({
          data: {
            token: mfaCode,
            tokenType: TokenType.MFA_TOKEN,
            email: signInInput.email,
          },
        });

        return {
          success: true,
          message: 'Proceed to MFA',
          proceedToMFA: true,
          redirectToSignIn: false,
          accessToken: '',
          refreshToken: '',
        };
      }

      const accessToken = this.jwtService.sign(
        { email: signInInput.email },
        { expiresIn: `${config.auth.accessTokenExpiryTime}h`, secret: config.jwt.access_token_secret }
      );

      const refreshToken = this.jwtService.sign(
        { email: signInInput.email },
        { expiresIn: `${config.auth.refreshTokenExpiryTime}d`, secret: config.jwt.refresh_token_secret }
      );

      return {
        success: true,
        message: 'SignIn success',
        proceedToMFA: false,
        redirectToSignIn: false,
        accessToken,
        refreshToken,
      };
    } catch (error) {
      Exception(error, 'SignIn failed');
    }
  }

  async signInMFA(signInMFAInput: SignInMFAInput): Promise<SignInOutput> {
    try {
      const mfaToken = await this.prisma.token.findUnique({
        where: { email_token: { email: signInMFAInput.email, token: signInMFAInput.token } },
      });

      let user = await this.prisma.user.findUnique({
        where: { email: signInMFAInput.email },
      });

      if (user.accountLockedAt) {
        const accountLockedDelta = differenceInMinutes(new Date(), user.accountLockedAt);

        if (accountLockedDelta < config.auth.accountLockedTimeInMins) {
          return {
            success: false,
            message: `Account locked temporarily, try after ${config.auth.accountLockedTimeInMins - accountLockedDelta}mins`,
            proceedToMFA: false,
            redirectToSignIn: true,
            accessToken: '',
            refreshToken: '',
          };
        } else {
          user = await this.prisma.user.update({
            where: { email: signInMFAInput.email },
            data: { accountLockedAt: null, failedLoginCount: 0 },
          });
        }
      }

      if (!mfaToken) {
        const res = await this.prisma.user.update({
          where: { email: signInMFAInput.email },
          data: { failedLoginCount: ++user.failedLoginCount },
        });

        if (res.failedLoginCount === config.auth.failedLoginCount) {
          await this.prisma.user.update({
            where: { email: signInMFAInput.email },
            data: { accountLockedAt: new Date() },
          });
        }

        throw new GraphQLError('Invalid MFA token, try again');
      }

      if (differenceInMinutes(new Date(), mfaToken.createdAt) > config.auth.mfaTokenExpiryTime) {
        return {
          success: false,
          message: 'Token Expired',
          proceedToMFA: false,
          redirectToSignIn: true,
          accessToken: '',
          refreshToken: '',
        };
      }

      const accessToken = this.jwtService.sign(
        { email: signInMFAInput.email },
        { expiresIn: `${config.auth.accessTokenExpiryTime}h`, secret: config.jwt.access_token_secret }
      );

      const refreshToken = this.jwtService.sign(
        { email: signInMFAInput.email },
        { expiresIn: `${config.auth.refreshTokenExpiryTime}d`, secret: config.jwt.refresh_token_secret }
      );

      await this.prisma.token.delete({
        where: { email_token: { email: signInMFAInput.email, token: signInMFAInput.token } },
      });

      return {
        success: true,
        message: 'SignIn MFA success',
        proceedToMFA: false,
        redirectToSignIn: false,
        accessToken,
        refreshToken,
      };
    } catch (error) {
      Exception(error, 'Multifactor authenticaton failed');
    }
  }

  async refreshToken(refreshTokenInput: RefreshTokenInput): Promise<RefreshTokenOutput> {
    try {
      const decoded: IJwtPayload = this.jwtService.verify(refreshTokenInput.refreshToken, {
        secret: config.jwt.refresh_token_secret,
      });

      const email = decoded.email;

      const user = await this.prisma.user.findUnique({
        where: { email: email },
      });

      if (!user) {
        throw new GraphQLError('Invalid User');
      }

      if (!user.verified) {
        throw new GraphQLError('User not verified');
      }

      if (!user.active) {
        throw new GraphQLError('Inactive User');
      }

      const accessToken = this.jwtService.sign(
        { email: email },
        { expiresIn: `${config.auth.accessTokenExpiryTime}h`, secret: config.jwt.access_token_secret }
      );
      const refreshToken = this.jwtService.sign(
        { email: email },
        { expiresIn: `${config.auth.refreshTokenExpiryTime}d`, secret: config.jwt.refresh_token_secret }
      );

      return { success: true, message: 'Refresh and Access tokens generated', accessToken, refreshToken };
    } catch (error) {
      Exception(error, 'Failed to generate refresh and access token');
    }
  }

  async forgotPassword(forgotPasswordInput: ForgotPasswordInput): Promise<AppResponse> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: forgotPasswordInput.email },
      });

      if (!user) {
        throw new GraphQLError('Invalid User');
      }

      const forgetPasswordToken = this.jwtService.sign(
        { email: forgotPasswordInput.email },
        { expiresIn: `${config.auth.forgotPasswordTokenExpiryTime}m`, secret: config.jwt.forgot_password_token_secret }
      );

      await this.mailService.send_email(
        'Forget Password Link',
        `token: ${forgetPasswordToken}`,
        forgotPasswordInput.email
      );

      await this.prisma.token.create({
        data: {
          token: forgetPasswordToken,
          tokenType: TokenType.FORGET_PASSWORD_TOKEN,
          email: forgotPasswordInput.email,
        },
      });

      return { success: true, message: 'Forgot password mail sent' };
    } catch (error) {
      Exception(error, 'Failed to sent forgot password mail');
    }
  }

  async resetPassword(resetPasswordInput: ResetPasswordInput): Promise<AppResponse> {
    try {
      const decoded: IJwtPayload = this.jwtService.verify(resetPasswordInput.token, {
        secret: config.jwt.forgot_password_token_secret,
      });

      const email = decoded.email;

      const forgotPasswordToken = await this.prisma.token.findUnique({
        where: { email_token: { email: email, token: resetPasswordInput.token } },
      });

      if (!forgotPasswordToken) {
        throw new GraphQLError('Invalid Token');
      }

      if (differenceInMinutes(new Date(), forgotPasswordToken.createdAt) > config.auth.forgotPasswordTokenExpiryTime) {
        throw new GraphQLError('Token Expired');
      }

      const user = await this.prisma.user.findFirst({ where: { email } });

      if (!user) {
        throw new GraphQLError('Invalid User');
      }

      const newPasswordHash = await bcryptjs.hash(resetPasswordInput.newPassword, config.auth.passwordHashSalt);

      await this.prisma.user.update({
        where: { email },
        data: { passwordHash: newPasswordHash },
      });

      await this.prisma.token.delete({
        where: { email_token: { email: email, token: resetPasswordInput.token } },
      });

      return { success: true, message: 'Reset password success' };
    } catch (error) {
      Exception(error, 'Reset password failed');
    }
  }
}
