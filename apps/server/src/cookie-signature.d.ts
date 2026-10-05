declare module "cookie-signature" {
  interface CookieSignature {
    sign(value: string, secret: string): string;
    unsign(value: string, secret: string): string | false;
  }
  const signature: CookieSignature;
  export default signature;
}
