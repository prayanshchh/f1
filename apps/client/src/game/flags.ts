const files = import.meta.glob<string>(
  "../../node_modules/flag-icons/flags/4x3/{ae,ar,at,au,az,be,bg,br,ca,ch,cl,cn,co,cz,de,dk,ee,eg,es,fi,fr,gb,gr,hk,hr,hu,id,ie,il,in,is,it,jp,ke,kr,lt,lu,lv,ma,mc,mx,my,ng,nl,no,nz,om,pe,ph,pk,pl,pt,qa,ro,rs,ru,sa,se,sg,si,sk,th,tr,tw,ua,us,uy,ve,vn,za}.svg",
  { eager: true, query: "?url", import: "default" },
);

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function codeOf(file: string): string {
  return (file.split("/").at(-1) ?? "").replace(".svg", "").toUpperCase();
}

export const countries = Object.keys(files)
  .map((file) => ({
    code: codeOf(file),
    name: regionNames.of(codeOf(file)) ?? codeOf(file),
    flag: files[file] ?? "",
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function flagUrl(code: string | null): string {
  return countries.find((country) => country.code === code)?.flag ?? "";
}

export function countryName(code: string | null): string {
  return countries.find((country) => country.code === code)?.name ?? "";
}

export function guessCountry(): string {
  const region = new Intl.Locale(navigator.language).region ?? "US";
  return countries.some((country) => country.code === region) ? region : "US";
}
