import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * POST /auth/login.
 *
 * This route took an inline `{ email, password }` type, which the global ValidationPipe
 * cannot see — types are erased at runtime, so a missing field, a number, or an object
 * reached Prisma and bcrypt as-is and came back as a 500 instead of a 400.
 *
 * The email's FORMAT is deliberately not checked: a malformed address matches no account
 * and gets the same "Invalid email or password" as any other miss, and a separate "not an
 * email" error would only be one more thing the response says about the input.
 */
export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(254)
  email!: string;

  // No MinLength — this is only ever compared, never stored, and a length rule here would
  // tell an attacker the policy. The ceiling just bounds the request: bcrypt reads only
  // the first 72 bytes, and older passwords may predate the 72-character cap on setting one.
  @IsString() @IsNotEmpty() @MaxLength(1024)
  password!: string;
}
