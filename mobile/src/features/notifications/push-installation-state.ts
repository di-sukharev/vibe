export const maxPushInstallationGeneration = 2_147_483_647;

export type PushInstallationMutation = {
  generation: number;
  installationId: string;
  installationSecret: string;
};

export type PushInstallationRegistration = PushInstallationMutation & {
  registeredUserId: string | null;
};

export function parsePushInstallationRegistration(
  value: string | null,
): PushInstallationRegistration | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<PushInstallationRegistration>;
    if (
      typeof parsed.installationId !== 'string' ||
      !isUuid(parsed.installationId) ||
      typeof parsed.installationSecret !== 'string' ||
      !isUuid(parsed.installationSecret) ||
      typeof parsed.generation !== 'number' ||
      !Number.isInteger(parsed.generation) ||
      parsed.generation <= 0 ||
      parsed.generation > maxPushInstallationGeneration ||
      (parsed.registeredUserId !== null && typeof parsed.registeredUserId !== 'string')
    ) {
      return null;
    }
    return {
      generation: parsed.generation,
      installationId: parsed.installationId,
      installationSecret: parsed.installationSecret,
      registeredUserId: parsed.registeredUserId ?? null,
    };
  } catch {
    return null;
  }
}

export function nextPushInstallationRegistration(
  current: PushInstallationRegistration | null,
  createInstallationId: () => string,
  createInstallationSecret: () => string,
): PushInstallationRegistration {
  const generation = (current?.generation ?? 0) + 1;
  if (generation > maxPushInstallationGeneration) {
    throw new Error('Push installation generation is exhausted');
  }
  return {
    generation,
    installationId: current?.installationId ?? createInstallationId(),
    installationSecret: current?.installationSecret ?? createInstallationSecret(),
    registeredUserId: current?.registeredUserId ?? null,
  };
}

export function isSamePushInstallationMutation(
  current: PushInstallationRegistration | null,
  mutation: PushInstallationMutation,
) {
  return (
    current?.generation === mutation.generation &&
    current.installationId === mutation.installationId &&
    current.installationSecret === mutation.installationSecret
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
