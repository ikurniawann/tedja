const HOLDING_CODE = process.env.SEED_HOLDING_CODE || "PROLOGE";
const COMPANY_CODE = process.env.SEED_COMPANY_CODE || "SULU";
const BRANCH_CODE = process.env.SEED_BRANCH_CODE || "SULU-BANDUNG";
const BRANCH_NAME = process.env.SEED_BRANCH_NAME || "Sulu Bandung";

async function resolveSeedBusinessScope(client) {
  const { rows } = await client.query(
    `SELECT h.id AS holding_id,
            c.id AS company_id,
            b.id AS branch_id,
            h.name AS holding_name,
            c.name AS company_name,
            b.name AS branch_name
     FROM configuration.holdings h
     JOIN configuration.companies c
       ON c.holding_id = h.id AND c.code = $2
     JOIN configuration.branches b
       ON b.company_id = c.id AND b.code = $3
     WHERE h.code = $1
       AND c.is_active = true
       AND b.is_active = true
     LIMIT 1`,
    [HOLDING_CODE, COMPANY_CODE, BRANCH_CODE]
  );

  if (!rows[0]) {
    throw new Error(
      `Seed scope tidak ditemukan (${HOLDING_CODE} / ${COMPANY_CODE} / ${BRANCH_CODE}). Jalankan seeder business hierarchy dulu.`
    );
  }

  return rows[0];
}

module.exports = {
  HOLDING_CODE,
  COMPANY_CODE,
  BRANCH_CODE,
  BRANCH_NAME,
  resolveSeedBusinessScope,
};
