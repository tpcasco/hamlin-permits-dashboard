import type { Adapter } from '../types';
import ocflGis from './ocfl-gis';
import ocpaParcels from './ocpa-parcels';
import ocflFasttrack from './ocfl-fasttrack';
import ocflDrc from './ocfl-drc-agendas';
import winterGarden from './winter-garden-bsa';
import horizonwestinfo from './horizonwestinfo';
import horizonwesthappenings from './horizonwesthappenings';
import horizonwestmagazine from './horizonwestmagazine';
import orangeobserver from './orangeobserver';
import growthspotter from './growthspotter';
import hamlinfl from './hamlinfl';
import businessSite from './business-site';

export const ADAPTERS: Adapter[] = [ocflGis, ocpaParcels, ocflFasttrack, ocflDrc, winterGarden, horizonwestinfo, horizonwesthappenings, horizonwestmagazine, orangeobserver, growthspotter, hamlinfl, businessSite];
