// Never rendered: middleware rewrites "/" to the static home.html when
// unlocked and to login.html otherwise. Present so Next has a root route.
export default function Page() {
  return null
}
