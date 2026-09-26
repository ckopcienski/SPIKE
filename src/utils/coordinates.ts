// Convert decimal degrees to DMS format
export function decimalToDMS(
  latitude: number,
  longitude: number,
): string {
  const latDir = latitude >= 0 ? 'N' : 'S';
  const lonDir = longitude >= 0 ? 'E' : 'W';

  const latAbs = Math.abs(latitude);
  const lonAbs = Math.abs(longitude);

  const latDeg = Math.floor(latAbs);
  const latMin = Math.floor((latAbs - latDeg) * 60);
  const latSec = ((latAbs - latDeg) * 60 - latMin) * 60;

  const lonDeg = Math.floor(lonAbs);
  const lonMin = Math.floor((lonAbs - lonDeg) * 60);
  const lonSec = ((lonAbs - lonDeg) * 60 - lonMin) * 60;

  return (
    `${latDeg}°${String(latMin).padStart(2, '0')}'${latSec.toFixed(1)}"${latDir} ` +
    `${lonDeg}°${String(lonMin).padStart(2, '0')}'${lonSec.toFixed(1)}"${lonDir}`
  );
}

// Convert decimal degrees to State Plane Ohio North (NAD83)
// Approximate conversion for Ohio State Plane North Zone (FIPS 3401)
export function toStatePlane(
  latitude: number,
  longitude: number,
): {northing: number; easting: number} {
  // Constants for Ohio State Plane North Zone NAD83 (Lambert Conformal Conic)
  const a = 6378137.0; // semi-major axis NAD83
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;
  const e = Math.sqrt(e2);

  const lat0 = (39 + 40 / 60) * (Math.PI / 180); // origin latitude
  const lon0 = -(82 + 30 / 60) * (Math.PI / 180); // central meridian
  const lat1 = (40 + 26 / 60) * (Math.PI / 180); // standard parallel 1
  const lat2 = (41 + 42 / 60) * (Math.PI / 180); // standard parallel 2
  const E0 = 600000.0; // false easting (meters)
  const N0 = 0.0; // false northing (meters)

  const lat = latitude * (Math.PI / 180);
  const lon = longitude * (Math.PI / 180);

  const sinLat1 = Math.sin(lat1);
  const sinLat2 = Math.sin(lat2);

  const m1 =
    Math.cos(lat1) /
    Math.sqrt(1 - e2 * sinLat1 * sinLat1);
  const m2 =
    Math.cos(lat2) /
    Math.sqrt(1 - e2 * sinLat2 * sinLat2);

  const t = (latVal: number) => {
    const sinL = Math.sin(latVal);
    return (
      Math.tan(Math.PI / 4 - latVal / 2) /
      Math.pow(
        (1 - e * sinL) / (1 + e * sinL),
        e / 2,
      )
    );
  };

  const t1 = t(lat1);
  const t2 = t(lat2);
  const t0 = t(lat0);
  const tP = t(lat);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);
  const rho = a * F * Math.pow(tP, n);

  const theta = n * (lon - lon0);

  const easting = E0 + rho * Math.sin(theta);
  const northing = N0 + rho0 - rho * Math.cos(theta);

  // Convert meters to feet
  const metersToFeet = 3.28083333;

  return {
    northing: northing * metersToFeet,
    easting: easting * metersToFeet,
  };
}

// Format State Plane coordinates for display
export function formatStatePlane(
  northing: number,
  easting: number,
): string {
  return `N ${northing.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} · E ${easting.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;
}

// Format State Plane for CSV export
export function formatStatePlaneCSV(
  northing: number,
  easting: number,
): {northing: string; easting: string} {
  return {
    northing: northing.toFixed(2),
    easting: easting.toFixed(2),
  };
}