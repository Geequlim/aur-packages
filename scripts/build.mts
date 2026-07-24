import { audit } from "./audit.mts";
import { downloadDmg } from "./download.mts";
import { extractDmg } from "./extract.mts";
import { prepareRunnableDirectory } from "./prepare.mts";

const dmg = await downloadDmg();
const source = await extractDmg(dmg);
const output = await prepareRunnableDirectory(source);
await audit(output);

