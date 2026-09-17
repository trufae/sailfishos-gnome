Name: sailfish-gnome-smoke
Version: 0.1
Release: 1
Summary: Compile and link a separate GTK4 and libadwaita consumer
License: GPL-3.0-or-later
Source0: %{name}-%{version}.tar.gz
BuildRequires: gcc
BuildRequires: vala
BuildRequires: sailfish-gnome-devel >= 0.1.0
%global debug_package %{nil}

%description
SDK build check only. This package is never published.

%prep
%setup -q

%build
pkg-config --modversion gtk4 libadwaita-1
valac --pkg gtk4 --pkg libadwaita-1 -o sailfish-gnome-smoke hello.vala

%install
install -D -m 0755 sailfish-gnome-smoke %{buildroot}%{_bindir}/sailfish-gnome-smoke

%files
%{_bindir}/sailfish-gnome-smoke
