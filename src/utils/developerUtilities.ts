import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import { parseDocument } from "yaml";
import { Cron } from "croner";
export type UtilityAction =
  | "json"
  | "base64-encode"
  | "base64-decode"
  | "url-encode"
  | "url-decode"
  | "jwt"
  | "sha256"
  | "uuid"
  | "timestamp"
  | "xml"
  | "yaml"
  | "cron";
export async function runUtility(
  action: UtilityAction,
  input: string,
): Promise<string> {
  if (input.length > 1_000_000)
    throw new Error("Use an input smaller than 1 MB");
  switch (action) {
    case "xml": {
      if (/<!DOCTYPE|<!ENTITY/i.test(input))
        throw new Error("DTD/entity declarations are not supported");
      const validation = XMLValidator.validate(input);
      if (validation !== true) throw new Error(validation.err.msg);
      const options = {
        preserveOrder: true,
        ignoreAttributes: false,
        parseTagValue: false,
        parseAttributeValue: false,
        processEntities: false,
      };
      return new XMLBuilder({ ...options, format: true }).build(
        new XMLParser(options).parse(input),
      );
    }
    case "yaml": {
      const document = parseDocument(input, { uniqueKeys: true });
      if (document.errors.length)
        throw new Error(
          document.errors.map((error) => error.message).join("\n"),
        );
      document.toJS({ maxAliasCount: 50 });
      return document.toString();
    }
    case "cron": {
      const job = new Cron(input.trim(), { timezone: "UTC", paused: true });
      try {
        return JSON.stringify(
          {
            timezone: "UTC",
            next: job.nextRuns(5).map((date) => date.toISOString()),
          },
          null,
          2,
        );
      } finally {
        job.stop();
      }
    }
    case "json":
      return JSON.stringify(JSON.parse(input), null, 2);
    case "base64-encode":
      return btoa(
        Array.from(new TextEncoder().encode(input), (byte) =>
          String.fromCharCode(byte),
        ).join(""),
      );
    case "base64-decode":
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(input.trim()), (c) => c.charCodeAt(0)),
      );
    case "url-encode":
      return encodeURIComponent(input);
    case "url-decode":
      return decodeURIComponent(input);
    case "jwt": {
      const parts = input.trim().split(".");
      if (parts.length !== 3)
        throw new Error("Expected a JWT with three segments");
      const decode = (part: string) => {
        const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(
              atob(
                normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
              ),
              (c) => c.charCodeAt(0),
            ),
          ),
        );
      };
      return JSON.stringify(
        {
          warning:
            "Decoded only. Signature, issuer, audience and expiry are NOT verified.",
          header: decode(parts[0]),
          payload: decode(parts[1]),
        },
        null,
        2,
      );
    }
    case "sha256":
      return Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(input),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    case "uuid":
      return crypto.randomUUID();
    case "timestamp": {
      if (!/^-?\d+(\.\d+)?$/.test(input.trim()))
        throw new Error("Enter a Unix timestamp in seconds");
      const date = new Date(Number(input) * 1000);
      if (!Number.isFinite(date.getTime()))
        throw new Error("Timestamp is out of range");
      return date.toISOString();
    }
  }
}
